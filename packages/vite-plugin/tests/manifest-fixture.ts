import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from '@animus-ui/extract/pipeline';

/**
 * A COMPLETE `ProjectManifest` at its empty-universe values, overridden per
 * test.
 *
 * The engine's `AnalyzeResult` declares no `Option` and no
 * `skip_serializing_if` at the top level (see `manifest-schema.ts`), so an
 * empty project still serializes `{}` / `[]` / `""` for every field — absence
 * means "not a manifest". Fakes that omitted fields were the only thing
 * keeping the plugin's `manifest?.sheets`-style shape guards alive; building
 * every fake from this base is what lets those guards go.
 */
export function makeManifest(
  overrides: Partial<ProjectManifest> = {}
): ProjectManifest {
  return {
    fileFacts: {},
    crossFile: {
      componentNames: [],
      classResolvers: [],
      memberBindings: {},
      renderedComponents: [],
      variantOptions: {},
      stateNames: {},
    },
    parseCount: 0,
    usageResidue: [],
    css: '',
    sheets: {
      declaration: '',
      global: '',
      base: '',
      variants: '',
      compounds: '',
      states: '',
      system: '',
      custom: '',
    },
    diagnostics: [],
    report: {
      components_total: 0,
      components_extracted: 0,
      components_eliminated: 0,
      variants_total: 0,
      variants_used: 0,
      variants_eliminated: 0,
      states_total: 0,
      states_used: 0,
      states_eliminated: 0,
      components_forced: 0,
      variants_forced: 0,
      states_forced: 0,
      eliminated_details: [],
    },
    system_prop_map: {},
    dynamic_props: {},
    component_fragments: {},
    reverse_provenance: {},
    components: {},
    files: {},
    timing: { parseCount: 0 },
    ...overrides,
  };
}

/**
 * One component descriptor. `file` and `replacement` are the two fields the
 * plugin reads (file-plan snapshots and raw-fallback provenance); the rest
 * carry the engine's own empty values so a fake descriptor is a whole one.
 */
export function makeComponent(
  file: string,
  replacement = ''
): ManifestComponentDescriptor {
  return {
    file,
    binding: '',
    class_name: '',
    extends_from: null,
    terminal: 'asElement',
    tag: 'div',
    replacement,
    system_prop_names: [],
  };
}
