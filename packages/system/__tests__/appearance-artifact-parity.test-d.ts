import type { AppearanceBootstrapArtifact } from '../src/bootstrap/createAppearanceBootstrap';

type Assert<T extends true> = T;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Transcribed from `AnimusExtractOptions['appearanceBootstrap']` in
 * `packages/vite-plugin/src/index.ts`; the two literals change together.
 */
type PluginMirror = { code: string; cspHash: string };

type _ArtifactMirrorIsExact = Assert<
  Exact<PluginMirror, AppearanceBootstrapArtifact>
>;

type _ExactRejectsRenamedMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; hash: string }
  > extends false
    ? true
    : false
>;

type _ExactRejectsRetypedMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; cspHash: string | undefined }
  > extends false
    ? true
    : false
>;

type _ExactRejectsExtraMember = Assert<
  Exact<
    { code: string; cspHash: string },
    { code: string; cspHash: string; nonce: string }
  > extends false
    ? true
    : false
>;
