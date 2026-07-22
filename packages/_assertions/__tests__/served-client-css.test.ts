import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AssertionError } from '../src/assert-css';
import { readRequiredCss } from '../src/find-build-assets';

const temporaryDirectories: string[] = [];

function scaffold(): { root: string; clientRoot: string; serverRoot: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'animus-served-client-css-'));
  temporaryDirectories.push(root);
  const clientRoot = join(root, 'client');
  const serverRoot = join(root, 'server');
  mkdirSync(clientRoot, { recursive: true });
  mkdirSync(serverRoot, { recursive: true });
  return { root, clientRoot, serverRoot };
}

const SEMANTIC_CSS = `@layer anm-base, anm-variants;
:root { --color-text: #111; }
@layer anm-base { .animus-card { padding: 8px; } }
@layer anm-variants { .animus-card--primary { color: red; } }
`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('readRequiredCss', () => {
  it('throws naming served-client CSS when only server output has CSS', async () => {
    const { clientRoot, serverRoot } = scaffold();
    // Valid CSS exists only under the server root; the client root is empty.
    writeFileSync(join(serverRoot, 'server.css'), SEMANTIC_CSS);

    await expect(
      readRequiredCss(clientRoot, 'vinext served-client CSS')
    ).rejects.toThrow(AssertionError);
    await expect(
      readRequiredCss(clientRoot, 'vinext served-client CSS')
    ).rejects.toThrow(/served-client/);
  });

  it('treats an empty CSS file under the client root as missing', async () => {
    const { clientRoot } = scaffold();
    writeFileSync(join(clientRoot, 'empty.css'), '   \n');

    await expect(
      readRequiredCss(clientRoot, 'vinext served-client CSS')
    ).rejects.toThrow(AssertionError);
  });

  it('returns only the client root CSS when it is non-empty', async () => {
    const { clientRoot, serverRoot } = scaffold();
    mkdirSync(join(clientRoot, 'assets'), { recursive: true });
    writeFileSync(join(clientRoot, 'assets', 'styles.css'), SEMANTIC_CSS);
    // Server CSS must never leak into the returned client CSS.
    writeFileSync(
      join(serverRoot, 'server.css'),
      '.server-only { color: hotpink; }'
    );

    const css = await readRequiredCss(clientRoot, 'vinext served-client CSS');

    expect(css).toContain('@layer anm-base');
    expect(css).toContain(':root');
    expect(css).toContain('animus-card');
    expect(css).not.toContain('server-only');
  });
});
