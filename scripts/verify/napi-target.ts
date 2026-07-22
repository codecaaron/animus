// scripts/verify/napi-target.ts
//
// Host-native NAPI target resolver (design decision D7). The v2 loader
// (packages/extract/crates/extract-v2/index.js) selects exactly one platform
// binary at runtime; freshness MUST be compared against that same binary and
// never the lexically-first `*.node` on disk — a foreign-target artifact's
// timestamp says nothing about the code this host's loader executes.
//
// Supported release matrix mirrors the CI napi build targets
// (.github/workflows/ci.yaml) and the dual-engine-build "supported target"
// requirement:
//   aarch64-apple-darwin      -> darwin-arm64
//   x86_64-unknown-linux-gnu  -> linux-x64-gnu
//   aarch64-unknown-linux-gnu -> linux-arm64-gnu
// Linux libc detection matches the loader's supported GNU targets and fails
// loud for anything outside the released matrix (including Linux musl). v1 is
// retired (retire-extract-v1), so only the v2 binary is resolved.

export type HostLibc = 'gnu' | 'musl' | null;

export interface HostTargetInput {
  platform: string;
  arch: string;
  libc?: HostLibc;
}

export const V2_BINARY_PREFIX = 'animus-extract-v2';
export const V2_CRATE_DIR = 'packages/extract/crates/extract-v2';

export class UnsupportedHostError extends Error {
  constructor(input: HostTargetInput) {
    super(
      `Unsupported host for v2 NAPI freshness: platform=${input.platform} ` +
        `arch=${input.arch} libc=${input.libc ?? 'n/a'}. Supported release ` +
        'targets: darwin-arm64, linux-x64-gnu, linux-arm64-gnu.'
    );
    this.name = 'UnsupportedHostError';
  }
}

// Pure map from {platform, arch, libc} to the napi target token embedded in the
// binary filename. Throws UnsupportedHostError for any host outside the
// supported release matrix (Linux musl included — it is never released).
export function resolveNapiTarget(input: HostTargetInput): string {
  const { platform, arch, libc } = input;
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'linux' && arch === 'x64' && libc === 'gnu') {
    return 'linux-x64-gnu';
  }
  if (platform === 'linux' && arch === 'arm64' && libc === 'gnu') {
    return 'linux-arm64-gnu';
  }
  throw new UnsupportedHostError(input);
}

export function resolveV2BinaryFilename(input: HostTargetInput): string {
  return `${V2_BINARY_PREFIX}.${resolveNapiTarget(input)}.node`;
}

export function resolveV2BinaryPath(input: HostTargetInput): string {
  return `${V2_CRATE_DIR}/${resolveV2BinaryFilename(input)}`;
}

// Host libc detection for Linux, mirroring the loader's musl probe: glibc hosts
// expose header.glibcVersionRuntime in the process report; musl hosts surface
// an ld-musl shared object. Anything indeterminate returns null so the resolver
// fails loud rather than guessing a released target.
export function detectHostLibc(platform: string = process.platform): HostLibc {
  if (platform !== 'linux') return null;
  try {
    const report =
      typeof process.report?.getReport === 'function'
        ? (process.report.getReport() as {
            header?: { glibcVersionRuntime?: string };
            sharedObjects?: string[];
          })
        : null;
    if (report?.header?.glibcVersionRuntime) return 'gnu';
    const shared = report?.sharedObjects ?? [];
    if (
      shared.some((f) => f.includes('libc.musl-') || f.includes('ld-musl-'))
    ) {
      return 'musl';
    }
  } catch {
    // Fall through to null → UnsupportedHostError (fail loud on unknown libc).
  }
  return null;
}

// Repo-relative path of the v2 binary THIS host loads. Used by both the CLI and
// the freshness precondition so they agree on a single selected binary.
export function resolveHostV2BinaryPath(): string {
  return resolveV2BinaryPath({
    platform: process.platform,
    arch: process.arch,
    libc: detectHostLibc(),
  });
}

// CLI: print the repo-relative path of the host-native v2 binary, or fail loud
// (non-zero) with the unsupported-host reason on stderr.
if (import.meta.main) {
  try {
    process.stdout.write(`${resolveHostV2BinaryPath()}\n`);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
