/** Mirrors `loadNative()` in extractor.js: the same host-native resolution, so
 *  a foreign-target artifact never counts as present. The candidate and
 *  required-dist lists are owned here — a restated copy in a consuming suite
 *  skips green instead of failing when a target triple moves. */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const EXTRACT_ROOT = join(TESTS_DIR, '..');
export const REPO_ROOT = join(EXTRACT_ROOT, '../..');

const BUILD_NAPI =
  "bun run --filter '@animus-ui/extract' build:extractor:debug";
const BUILD_DISTS = 'vp run build:ts';

export interface EnginePrerequisites {
  ok: boolean;
  reason: string;
}

function hostNativeBinaryExists(): boolean {
  const { platform, arch } = process;
  const candidates = [
    `animus-extractor.${platform}-${arch}.node`,
    `animus-extractor.${platform}-${arch}-gnu.node`,
    `animus-extractor.${platform}-${arch}-msvc.node`,
  ];
  return candidates.some((name) =>
    existsSync(join(EXTRACT_ROOT, 'crates/extractor', name))
  );
}

const REQUIRED_DISTS = [
  'packages/extract/dist/index.cjs',
  'packages/system/dist/index.js',
  'packages/properties/dist/index.js',
] as const;

export function probeEnginePrerequisites(): EnginePrerequisites {
  if (!hostNativeBinaryExists()) {
    return {
      ok: false,
      reason: `extractor NAPI native binary not found for ${process.platform}-${process.arch} under packages/extract/crates/extractor/. Run: ${BUILD_NAPI}`,
    };
  }

  const missingDist = REQUIRED_DISTS.find(
    (rel) => !existsSync(join(REPO_ROOT, rel))
  );
  if (missingDist) {
    return { ok: false, reason: `${missingDist} missing. Run: ${BUILD_DISTS}` };
  }

  return { ok: true, reason: '' };
}
