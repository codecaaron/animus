/**
 * The CLI surface, driven in process.
 *
 * `runCli` takes its streams as arguments precisely so this file needs no
 * subprocess: the assertions are about the two things a command line
 * guarantees — the stream discipline (stdout is machine-only) and the exit
 * taxonomy (the code is the verdict, not a success flag).
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run';

const FIXTURE = join(__dirname, 'fixtures/rollup-app');

const ALERT_POINT =
  'viewport.inline=390,mode=dark,variant:Alert:variant=outline,' +
  'variant:Alert:intent=danger';

interface Capture {
  stdout: { write(text: string): unknown; text(): string };
  stderr: { write(text: string): unknown; text(): string };
}

const capture = (): Capture => {
  const sink = (): { write(text: string): unknown; text(): string } => {
    const chunks: string[] = [];
    return {
      write: (text: string) => chunks.push(text),
      text: () => chunks.join(''),
    };
  };
  return { stdout: sink(), stderr: sink() };
};

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = async (...argv: string[]): Promise<Run> => {
  const io = capture();
  const code = await runCli(argv, io);
  return { code, stdout: io.stdout.text(), stderr: io.stderr.text() };
};

describe('cli — machine output on stdout', () => {
  it('round-trips the probe envelope as JSON and leaves stderr empty', async () => {
    const result = await run(
      'inspect',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT,
      '--json'
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const envelope = JSON.parse(result.stdout) as {
      command: string;
      target: string;
      at: Record<string, unknown>;
      result: {
        verdict: string;
        facts: { property: string; value: { value?: string } }[];
      };
    };

    expect(envelope.command).toBe('inspect');
    expect(envelope.target).toBe(
      '../../packages/test-ds/src/components/Alert.tsx::Alert'
    );
    expect(envelope.at).toEqual({
      'viewport.inline': 390,
      mode: 'dark',
      'variant:Alert:variant': 'outline',
      'variant:Alert:intent': 'danger',
    });
    expect(envelope.result.verdict).toBe('ESTABLISHED');

    const color = envelope.result.facts.find(
      (fact) => fact.property === 'color'
    );
    expect(color?.value.value).toBe('#ef4444');
  });

  it('serialises the equivalence classes for the classes command', async () => {
    const result = await run(
      'classes',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--json'
    );
    const envelope = JSON.parse(result.stdout) as {
      command: string;
      result: { classes: { cellCount: number }[] };
    };

    expect(result.code).toBe(0);
    expect(envelope.command).toBe('classes');
    expect(envelope.result.classes).toHaveLength(6);
  });
});

describe('cli — the human report on stderr', () => {
  it('writes sections to stderr and nothing at all to stdout', async () => {
    const result = await run(
      'inspect',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');

    // Vacuity guards: the named sections and a real fact line, not merely
    // non-empty output.
    expect(result.stderr).toContain('VERDICT ESTABLISHED');
    expect(result.stderr).toContain(
      'TARGET Alert · ../../packages/test-ds/src/components/Alert.tsx::Alert'
    );
    expect(result.stderr).toContain('classes animus-Alert-a385f997 ');
    expect(result.stderr).toMatch(
      /\n {2}color: #ef4444 ← [0-9a-f]{16} \(.*compound\) @ .*Alert\.tsx:716-758/
    );
    expect(result.stderr).toContain('COVERAGE');
    expect(result.stderr).toContain('NEXT');
  });

  it('renders a witness and the semantic diff in their own sections', async () => {
    const proved = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'effective-value:color=#ef4444'
    );
    expect(proved.stderr).toContain('WITNESSES');
    expect(proved.stderr).toContain("(expected '#ef4444')");

    const simulated = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT,
      '--remove',
      'color'
    );
    expect(simulated.code).toBe(0);
    expect(simulated.stderr).toContain('SEMANTIC DIFF');
    expect(simulated.stderr).toContain('color: rule-activated #ef4444 → ');
    expect(simulated.stderr).toContain('CAUSAL FINDINGS');
    // `--remove color` resolved the *current winner* — the compound rule.
    expect(simulated.stderr).toMatch(
      /Simulating remove color from rule [0-9a-f]{16}/
    );
  });
});

describe('cli — the exit taxonomy', () => {
  it('exits 0 for --help and prints the grammar to stderr', async () => {
    const result = await run('--help');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('animus-oracle — the Animus render oracle');
    expect(result.stderr).toContain('--assert <spec> (prove):');
    expect(result.stderr).toContain('Exit codes:');
  });

  it('exits 1 for DISPROVED', async () => {
    const result = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'effective-value:color=#ef4444'
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('VERDICT DISPROVED');
  });

  it('exits 2 for an unknown command, printing the usage', async () => {
    const result = await run('frobnicate', '--dir', FIXTURE);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown command 'frobnicate'");
    expect(result.stderr).toContain('Usage:');
  });

  it('exits 2 for an unknown flag and for a missing required flag', async () => {
    const flag = await run('inspect', '--dir', FIXTURE, '--nope');
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain('--nope');

    const missing = await run('inspect', '--dir', FIXTURE);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('inspect: --target is required');

    const property = await run(
      'explain',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--symptom',
      'unexpected-value'
    );
    expect(property.code).toBe(2);
    expect(property.stderr).toContain('explain: --property is required');
  });

  it('exits 2 for an unknown scenario name, listing the declared ones', async () => {
    const result = await run(
      'inspect',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      'compact.dark'
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--at 'compact.dark': unknown named");
    expect(result.stderr).toContain('md.dark');
    expect(result.stderr).toContain('base.light');
  });

  it('exits 2 when a delta names a property nothing sets here', async () => {
    const result = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT,
      '--remove',
      'letter-spacing'
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--remove 'letter-spacing': nothing sets");
    expect(result.stderr).toContain('properties with a winner here:');
  });

  it('exits 3 when the artifact directory is not one', async () => {
    const result = await run(
      'inspect',
      '--dir',
      join(FIXTURE, 'not-a-build'),
      '--target',
      'Alert'
    );

    expect(result.code).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('is not an animus artifact directory');
    expect(result.stderr).toContain('animus build');
  });

  it('exits 4 for INCONCLUSIVE — a budget refusal, never a partial proof', async () => {
    const result = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'effective-value:color=#ef4444',
      '--max-cells',
      '1'
    );

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('VERDICT INCONCLUSIVE');
    expect(result.stderr).toContain('over the budget of 1');
  });

  it('exits 4 for CONDITIONAL — an open obligation touches the property', async () => {
    const result = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Card',
      '--assert',
      'effective-value-in:padding=1rem|1.5rem'
    );

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('VERDICT CONDITIONAL');
    expect(result.stderr).toContain('UNKNOWNS');
    expect(result.stderr).toContain('[geometry]');
  });

  it('exits 2 with no command, and 0 once a command settles', async () => {
    const empty = await run();
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('no command given');

    const settled = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'no-important'
    );
    expect(settled.code).toBe(0);
    expect(settled.stderr).toContain('VERDICT PROVED');
  });
});

describe('cli — the flag grammar', () => {
  it('parses every assert kind and refuses an unknown one', async () => {
    const proved = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'no-important',
      '--assert',
      'mode-invariant:padding',
      '--assert',
      'effective-value-in:padding=0.75rem|1rem',
      '--assert',
      'winner-origin-token:color=--color-danger'
    );
    expect(proved.stderr).toContain('Checked 4 assertions');

    const unknown = await run(
      'prove',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--assert',
      'looks-nice:color'
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("unknown assertion kind 'looks-nice'");
  });

  it('accepts the agent-shaped exact delta and a token replacement', async () => {
    const byRule = await run(
      'diff',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--remove-rule',
      'a5e7b19f52a9de29:color',
      '--json'
    );
    const envelope = JSON.parse(byRule.stdout) as {
      result: { semanticDiff: { entries: { property: string }[] } };
    };
    expect(byRule.code).toBe(0);
    expect(
      envelope.result.semanticDiff.entries.some(
        (entry) => entry.property === 'color'
      )
    ).toBe(true);

    const byToken = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT,
      '--replace-token=--color-danger=#000000'
    );
    expect(byToken.code).toBe(0);
    expect(byToken.stderr).toContain('replace token --color-danger with');
    expect(byToken.stderr).toContain('#ef4444 → #000000');
  });

  it('refuses a malformed delta rather than testing something else', async () => {
    const badRule = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--remove-rule',
      'no-colon-here'
    );
    expect(badRule.code).toBe(2);
    expect(badRule.stderr).toContain('write <ruleId>:<property>');

    const badToken = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--replace-token=--color-danger'
    );
    expect(badToken.code).toBe(2);
    expect(badToken.stderr).toContain('write <--token>=<value>');

    const noDeltas = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert'
    );
    expect(noDeltas.code).toBe(2);
    expect(noDeltas.stderr).toContain('at least one delta is required');
  });

  it('forces a scenario binding across both worlds', async () => {
    const result = await run(
      'simulate',
      '--dir',
      FIXTURE,
      '--target',
      'Alert',
      '--at',
      ALERT_POINT,
      '--force',
      'mode=light'
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('force mode = light');
  });

  it('reports an unresolved obligation id as a usage error', async () => {
    const result = await run(
      'refine',
      '--dir',
      FIXTURE,
      '--obligation',
      'not-an-obligation'
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown obligation 'not-an-obligation'");
  });
});
