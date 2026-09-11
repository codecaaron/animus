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

interface HostDiagnosticReport {
  header?: { glibcVersionRuntime?: string };
  sharedObjects?: string[];
}

export function detectHostLibc(platform: string = process.platform): HostLibc {
  if (platform !== 'linux') return null;
  try {
    // `process.report` is absent on runtimes that publish no diagnostic report,
    // and `getReport` must be called on its owner to keep its receiver.
    const processReport = process.report;
    if (processReport?.getReport === undefined) return null;
    // SAFETY: @types/node declares `getReport()` as a bare `object`; only the
    // two optional fields of `HostDiagnosticReport` are read from it.
    const report = processReport.getReport() as HostDiagnosticReport;
    if (report.header?.glibcVersionRuntime) return 'gnu';
    const shared = report.sharedObjects ?? [];
    if (
      shared.some((f) => f.includes('libc.musl-') || f.includes('ld-musl-'))
    ) {
      return 'musl';
    }
  } catch {}
  return null;
}

export function resolveHostV2BinaryPath(): string {
  return resolveV2BinaryPath({
    platform: process.platform,
    arch: process.arch,
    libc: detectHostLibc(),
  });
}

if (import.meta.main) {
  try {
    process.stdout.write(`${resolveHostV2BinaryPath()}\n`);
  } catch (error) {
    // SAFETY: the only throw reachable here is `UnsupportedHostError`, which
    // extends Error; the report probe swallows its own failures.
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
