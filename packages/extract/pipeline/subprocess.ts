import { execSync } from 'child_process';

let cachedRuntime: 'bun' | 'node' | null = null;

/**
 * Detect which JS runtime is available for subprocess execution.
 * Prefers bun (faster startup), falls back to node.
 * Result is cached for the process lifetime.
 */
export function detectRuntime(): 'bun' | 'node' {
  if (cachedRuntime) return cachedRuntime;

  try {
    execSync('bun --version', { stdio: 'ignore' });
    cachedRuntime = 'bun';
  } catch {
    cachedRuntime = 'node';
  }

  return cachedRuntime;
}

/**
 * Execute a CJS script string via the detected runtime.
 * The script must use `require()` and synchronous Node APIs — compatible with both bun and node.
 *
 * @param script - The CJS script content to execute
 * @param cwd - Working directory for the subprocess
 * @param args - Optional CLI arguments passed after the script path
 * @returns stdout of the subprocess
 */
export function execSubprocess(
  script: string,
  cwd: string,
  args: string[] = []
): string {
  const { writeFileSync, unlinkSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');

  const runtime = detectRuntime();
  const ts = Date.now();
  const tmpScript = join(tmpdir(), `animus-subprocess-${ts}.cjs`);

  writeFileSync(tmpScript, script);

  try {
    const argsStr = args.map((a) => `"${a}"`).join(' ');
    const cmd =
      runtime === 'bun'
        ? `bun run "${tmpScript}" ${argsStr}`
        : `node "${tmpScript}" ${argsStr}`;

    return execSync(cmd, { cwd, encoding: 'utf-8' });
  } finally {
    try {
      unlinkSync(tmpScript);
    } catch {}
  }
}
