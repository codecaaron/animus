import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run';
import { createPlacesSession, runSession } from '../src/cli/session';

import type { SessionResponse } from '../src/cli/session';

/**
 * PLACES.md §6 — warm operation and the CI gate. One loaded snapshot answers
 * many JSONL requests; artifact staleness turns every answer into an
 * explicit refusal; and `check` runs the correspondence guard over every
 * file as a batch gate with the exit code as the verdict.
 */

const FIXTURE = join(__dirname, 'fixtures/rollup-app');
const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
const GROUP_FILE = 'src/Group.tsx';
const GROUP_ITEM_CLASS = 'animus-GroupItem-32b2d32f';

const groupSource = readFileSync(join(SOURCE_ROOT, GROUP_FILE), 'utf8');

const offsetOf = (marker: string): number => {
  const offset = groupSource.indexOf(marker);
  expect(offset).toBeGreaterThan(0);
  return offset;
};

const okResult = (response: SessionResponse): unknown => {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('unreachable');
  return response.result;
};

describe('the warm session protocol', () => {
  const session = createPlacesSession(FIXTURE, { sourceRoot: SOURCE_ROOT });

  it('describes its snapshot: generation, size, freshness', () => {
    const result = okResult(
      session.handle({ id: 1, op: 'snapshot' }).response
    ) as Record<string, unknown>;
    expect(result.generation).toMatch(/^animus-commit:/);
    expect(result.files).toBeGreaterThan(0);
    expect(result.freshness).toEqual({ fresh: true });
  });

  it('answers place questions warm, straight from file+offset', () => {
    const response = session.handle({
      id: 2,
      op: 'explain',
      file: GROUP_FILE,
      offset: offsetOf('active kit item'),
      property: 'color',
      at: { mode: 'dark' },
    }).response;
    const result = okResult(response) as {
      winner?: { selector: string };
    };
    expect(result.winner?.selector).toBe(
      `[data-color-mode="dark"] .${GROUP_ITEM_CLASS}`
    );
  });

  it('serves locate and observe over the wire shape', () => {
    const located = okResult(
      session.handle({
        op: 'locate',
        observation: {
          source: 'dom',
          subject: { classes: [GROUP_ITEM_CLASS] },
        },
      }).response
    ) as { matches: readonly { candidates: readonly unknown[] }[] };
    expect(located.matches).toHaveLength(1);
    expect(located.matches[0].candidates).toHaveLength(4);

    const observed = okResult(
      session.handle({
        op: 'observe',
        file: GROUP_FILE,
        offset: offsetOf('framed kit item'),
        observation: {
          source: 'ssr',
          ancestors: [
            {
              tag: 'section',
              classes: ['frame'],
              attributes: { 'data-active': 'true' },
            },
          ],
          completeToRoot: true,
        },
      }).response
    ) as { discharged: readonly { axis: string }[] };
    expect(observed.discharged.length).toBeGreaterThan(0);
  });

  it('surfaces a correspondence refusal, never a bare null', () => {
    const response = session.handle({
      op: 'place',
      file: 'src/App.tsx',
      offset: 10,
    }).response;
    expect(response).toMatchObject({ ok: false, kind: 'refused' });
    if (!response.ok) expect(response.error).toMatch(/not part of/);
  });

  it('rejects an unknown op with the supported list', () => {
    const response = session.handle({ op: 'transmogrify' }).response;
    expect(response).toMatchObject({ ok: false, kind: 'usage' });
    if (!response.ok) expect(response.error).toMatch(/locate/);
  });

  it('rejects a non-JSON line without dying', () => {
    const outcome = session.handleLine('{nope');
    expect(outcome.response).toMatchObject({ ok: false, kind: 'usage' });
    expect(outcome.close).toBe(false);
  });

  it('carries a candidate repair through the warm surface', () => {
    const darkRule = session.snapshot.host.universe
      .universe()
      .rules.find(
        (rule) =>
          rule.selector.raw === `[data-color-mode="dark"] .${GROUP_ITEM_CLASS}`
      );
    expect(darkRule).toBeDefined();
    const outcomes = okResult(
      session.handle({
        op: 'carry',
        component: 'GroupItem',
        property: 'color',
        deltas: [
          {
            kind: 'remove-declaration',
            rule: darkRule?.id,
            property: 'color',
          },
        ],
      }).response
    ) as readonly { outcome: string }[];
    expect(new Set(outcomes.map((row) => row.outcome))).toEqual(
      new Set(['changed', 'stable', 'ambiguous', 'inaccessible'])
    );
  });
});

describe('staleness ends the warmth, explicitly', () => {
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'places-session-'));
    cpSync(FIXTURE, dir, { recursive: true });
    return dir;
  };

  it('refuses every op but snapshot once the artifacts change', () => {
    const dir = scratch();
    const session = createPlacesSession(dir, { sourceRoot: SOURCE_ROOT });
    expect(session.handle({ op: 'files' }).response.ok).toBe(true);

    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, `${readFileSync(manifestPath, 'utf8')}\n`);

    const refused = session.handle({ op: 'files' }).response;
    expect(refused).toMatchObject({ ok: false, kind: 'stale-snapshot' });
    if (!refused.ok) expect(refused.changed).toContain('manifest.json');

    // `snapshot` still answers — it is how the client learns to restart.
    const described = okResult(session.handle({ op: 'snapshot' }).response) as {
      freshness: { fresh: boolean };
    };
    expect(described.freshness.fresh).toBe(false);
  });
});

describe('the JSONL stream loop', () => {
  it('answers each line and closes on shutdown', async () => {
    const stdin = new PassThrough();
    const out: string[] = [];
    const errs: string[] = [];
    stdin.write(`${JSON.stringify({ id: 'a', op: 'snapshot' })}\n`);
    stdin.write('\n');
    stdin.write(`${JSON.stringify({ id: 'b', op: 'shutdown' })}\n`);
    stdin.end();

    const code = await runSession(
      FIXTURE,
      { sourceRoot: SOURCE_ROOT },
      {
        stdin,
        stdout: { write: (text: string) => out.push(text) },
        stderr: { write: (text: string) => errs.push(text) },
      }
    );

    expect(code).toBe(0);
    const responses = out.map(
      (line) => JSON.parse(line) as { id?: string; ok: boolean }
    );
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ id: 'a', ok: true });
    expect(responses[1]).toMatchObject({ id: 'b', ok: true });
    expect(errs.join('')).toMatch(/session open/);
  });
});

describe('check — the correspondence guard as a CI gate', () => {
  it('exits 0 with a fully corresponding tree', async () => {
    const out: string[] = [];
    const code = await runCli(
      ['check', '--dir', FIXTURE, '--source-root', SOURCE_ROOT, '--json'],
      {
        stdout: { write: (text: string) => out.push(text) },
        stderr: { write: () => undefined },
      }
    );
    expect(code).toBe(0);
    const envelope = JSON.parse(out.join('')) as {
      command: string;
      result: { ok: boolean; files: readonly { ok: boolean }[] };
    };
    expect(envelope.command).toBe('check');
    expect(envelope.result.ok).toBe(true);
    expect(envelope.result.files.length).toBeGreaterThan(0);
  });

  it('exits 1 naming the diverged file when the tree drifts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'places-check-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, GROUP_FILE),
      groupSource.replace(
        '<div className="group" data-active="true">',
        '<div className="group" data-active="maybe">'
      )
    );

    const out: string[] = [];
    const errs: string[] = [];
    const code = await runCli(
      ['check', '--dir', FIXTURE, '--source-root', root, '--json'],
      {
        stdout: { write: (text: string) => out.push(text) },
        stderr: { write: (text: string) => errs.push(text) },
      }
    );
    expect(code).toBe(1);
    const envelope = JSON.parse(out.join('')) as {
      result: {
        ok: boolean;
        files: readonly { file: string; ok: boolean; reason?: string }[];
      };
    };
    expect(envelope.result.ok).toBe(false);
    const failing = envelope.result.files.filter((entry) => !entry.ok);
    expect(failing.map((entry) => entry.file)).toContain(GROUP_FILE);
  });
});
