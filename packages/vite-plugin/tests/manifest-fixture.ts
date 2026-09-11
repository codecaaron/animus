import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from '@animus-ui/extract/pipeline';

/** A complete `ProjectManifest` at its empty values. The engine serializes
 *  every field even for an empty project, so absence means "not a manifest". */
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
