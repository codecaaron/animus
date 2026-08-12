import { contentHash } from './content-hash';

export type SvelteScriptScope = 'module' | 'instance';

export interface SourceSpan {
  /** Inclusive UTF-8 byte offset. */
  start: number;
  /** Exclusive UTF-8 byte offset. */
  end: number;
}

export interface SourcePosition {
  /** One-based line number, matching Svelte compiler locations. */
  line: number;
  /** Zero-based UTF-16 column, matching Svelte compiler locations. */
  column: number;
}

export interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}

export interface SvelteSourceOrigin {
  path: string;
  hash: string;
}

export type SvelteOriginMappingKind = 'resolver' | 'attribute' | 'value';

export interface SvelteOriginMapping {
  kind: SvelteOriginMappingKind;
  generated: SourceSpan;
  original: SourceSpan;
}

export interface SvelteVirtualEntry {
  scope: SvelteScriptScope;
  /** Parser-only identity. Original source identity remains authoritative. */
  path: string;
  source: string;
  mappings: SvelteOriginMapping[];
}

export interface SvelteAdapterDiagnostic {
  code:
    | 'SVELTE_PARSE_ERROR'
    | 'SVELTE_ATTRS_IMPORT_UNSUPPORTED'
    | 'SVELTE_ATTRS_SCOPE_UNSUPPORTED'
    | 'SVELTE_ATTRS_CALLEE_UNSUPPORTED'
    | 'SVELTE_ATTRS_TEMPLATE_UNSUPPORTED'
    | 'SVELTE_ATTRS_ARGUMENT_UNRESOLVED'
    | 'SVELTE_ATTRS_COMPUTED_KEY'
    | 'SVELTE_ATTRS_SPREAD_UNRESOLVED'
    | 'SVELTE_ATTRS_PROPERTY_UNSUPPORTED'
    | 'SVELTE_ATTRS_VALUE_UNSUPPORTED';
  message: string;
  originalPath: string;
  /** Present only when the parser supplied an exact original-source node. */
  span?: SourceSpan;
  /** Structured original-source location for every exact diagnostic span. */
  location?: SourceLocation;
}

export type SvelteResolverImportKind =
  | 'named'
  | 'string-named'
  | 'named-default'
  | 'default'
  | 'namespace';

export type SvelteResolverAccess =
  | {
      kind: 'direct';
      importKind: SvelteResolverImportKind;
    }
  | {
      kind: 'namespace-member';
      importKind: 'namespace';
    };

export interface SvelteResolverAttributionRequest {
  source: string;
  imported: string;
  local: string;
  access: SvelteResolverAccess;
}

export type SvelteResolverAttribution =
  | 'resolver'
  | 'unsupported-resolver-form'
  | 'other';

export interface AdaptSvelteSourceOptions {
  /** Classify an import access using caller-owned extraction metadata. */
  attributeResolver(
    request: SvelteResolverAttributionRequest
  ): SvelteResolverAttribution;
}

export type AdaptSvelteSourceResult =
  | {
      kind: 'ok';
      original: SvelteSourceOrigin;
      entries: SvelteVirtualEntry[];
    }
  | {
      kind: 'missing-dep';
      original: SvelteSourceOrigin;
      dependency: 'svelte/compiler';
    }
  | {
      kind: 'error';
      original: SvelteSourceOrigin;
      diagnostics: SvelteAdapterDiagnostic[];
    };

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface ProgramNode extends AstNode {
  body: AstNode[];
}

interface ScriptNode extends AstNode {
  content: ProgramNode;
}

interface SvelteAst {
  module?: ScriptNode | null;
  instance?: ScriptNode | null;
  /** Template markup AST — scanned so resolver calls written in markup
   *  fail closed instead of silently contributing no usage witness. */
  fragment?: AstNode | null;
}

interface SvelteCompiler {
  parse(source: string, options: { filename: string; modern: true }): SvelteAst;
}

interface ImportBinding {
  kind: SvelteResolverImportKind;
  source: string;
  imported: string;
  declaration: AstNode;
  specifier: AstNode;
  local: AstNode;
}

interface WitnessProperty {
  name: string;
  property: AstNode;
  key: AstNode;
  value: AstNode;
}

interface Witness {
  binding: ImportBinding;
  resolver: AstNode;
  properties: WitnessProperty[];
}

interface ScopeProjection {
  entry?: SvelteVirtualEntry;
  diagnostics: SvelteAdapterDiagnostic[];
}

interface CompilerErrorPoint {
  line?: unknown;
  column?: unknown;
  character?: unknown;
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { start?: unknown }).start === 'number' &&
    typeof (value as { end?: unknown }).end === 'number'
  );
}

function childNode(value: unknown): AstNode | null {
  return isNode(value) ? value : null;
}

function nodeName(node: AstNode | null): string | null {
  return node?.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : null;
}

/** Adaptation touches one source at a time, so a last-value memo makes the
 *  all-ASCII check O(n) once per file instead of per span endpoint. */
let asciiMemoSource: string | null = null;
let asciiMemoValue = false;
function isAsciiOnly(source: string): boolean {
  if (asciiMemoSource !== source) {
    asciiMemoSource = source;
    asciiMemoValue = Buffer.byteLength(source) === source.length;
  }
  return asciiMemoValue;
}

function byteOffset(source: string, characterOffset: number): number {
  // ASCII fast path: character offsets ARE byte offsets. The non-ASCII arm
  // keeps the prefix copy — correct and rare enough not to earn a table.
  if (isAsciiOnly(source)) return characterOffset;
  return Buffer.byteLength(source.slice(0, characterOffset));
}

function byteSpan(
  source: string,
  node: Pick<AstNode, 'start' | 'end'>
): SourceSpan {
  return {
    start: byteOffset(source, node.start),
    end: byteOffset(source, node.end),
  };
}

function sourcePosition(
  source: string,
  characterOffset: number
): SourcePosition {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < characterOffset; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 0x0d) {
      if (
        index + 1 < characterOffset &&
        source.charCodeAt(index + 1) === 0x0a
      ) {
        index += 1;
      }
      line += 1;
      lineStart = index + 1;
    } else if (code === 0x0a || code === 0x2028 || code === 0x2029) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: characterOffset - lineStart };
}

function sourceLocation(
  source: string,
  node: Pick<AstNode, 'start' | 'end'>
): SourceLocation {
  return {
    start: sourcePosition(source, node.start),
    end: sourcePosition(source, node.end),
  };
}

function createsNestedBindingScope(node: AstNode): boolean {
  return (
    node.type === 'BlockStatement' ||
    node.type === 'CatchClause' ||
    node.type === 'ClassBody' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement' ||
    node.type === 'ForStatement' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'StaticBlock' ||
    node.type === 'SwitchStatement' ||
    node.type === 'TSModuleBlock'
  );
}

function walk(
  node: AstNode,
  visit: (node: AstNode, nestedScopeDepth: number) => void,
  nestedScopeDepth = 0
): void {
  visit(node, nestedScopeDepth);
  const childScopeDepth =
    nestedScopeDepth + (createsNestedBindingScope(node) ? 1 : 0);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit, childScopeDepth);
      }
    } else if (isNode(value)) {
      walk(value, visit, childScopeDepth);
    }
  }
}

/**
 * Fragment traversal: Svelte `Fragment` containers (the template root and
 * every block body) carry no `start`/`end`, so the script walker's isNode
 * gate would stop at each one. Descend through every plain object/array,
 * visit only span-carrying nodes, and guard against metadata back-references.
 */
function walkFragment(value: unknown, visit: (node: AstNode) => void): void {
  const seen = new WeakSet<object>();
  const descend = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) descend(item);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    if (seen.has(current)) return;
    seen.add(current);
    if (isNode(current)) visit(current);
    for (const [key, child] of Object.entries(current)) {
      if (
        key === 'loc' ||
        key === 'start' ||
        key === 'end' ||
        key === 'metadata' ||
        key === 'parent'
      ) {
        continue;
      }
      descend(child);
    }
  };
  descend(value);
}

function importBindings(program: ProgramNode): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const declaration of program.body) {
    if (
      declaration.type !== 'ImportDeclaration' ||
      declaration.importKind === 'type' ||
      !Array.isArray(declaration.specifiers)
    ) {
      continue;
    }
    for (const value of declaration.specifiers) {
      if (!isNode(value) || value.importKind === 'type') continue;
      const local = childNode(value.local);
      const localName = nodeName(local);
      if (!local || !localName) continue;
      const sourceNode = childNode(declaration.source);
      const importSource =
        sourceNode && typeof sourceNode.value === 'string'
          ? sourceNode.value
          : null;
      if (!importSource) continue;
      const namedImported = importedName(value);
      if (value.type === 'ImportSpecifier' && namedImported === null) continue;
      const importedNode = childNode(value.imported);
      const kind =
        value.type === 'ImportSpecifier'
          ? importedNode?.type === 'Literal'
            ? 'string-named'
            : namedImported === 'default'
              ? 'named-default'
              : 'named'
          : value.type === 'ImportDefaultSpecifier'
            ? 'default'
            : value.type === 'ImportNamespaceSpecifier'
              ? 'namespace'
              : null;
      if (kind) {
        bindings.set(localName, {
          kind,
          source: importSource,
          imported:
            kind === 'default' || kind === 'named-default'
              ? 'default'
              : kind === 'namespace'
                ? '*'
                : namedImported!,
          declaration,
          specifier: value,
          local,
        });
      }
    }
  }
  return bindings;
}

function diagnostic(
  code: SvelteAdapterDiagnostic['code'],
  message: string,
  originalPath: string,
  source: string,
  node?: AstNode,
  location?: SourceLocation
): SvelteAdapterDiagnostic {
  return {
    code,
    message,
    originalPath,
    ...(node
      ? {
          span: byteSpan(source, node),
          location: location ?? sourceLocation(source, node),
        }
      : {}),
  };
}

function compilerParseErrorRange(
  error: unknown,
  source: string
): { node: AstNode; location: SourceLocation } | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    start?: CompilerErrorPoint;
    end?: CompilerErrorPoint;
    position?: unknown;
  };
  const positions = Array.isArray(candidate.position) ? candidate.position : [];
  const startCharacter =
    typeof candidate.start?.character === 'number'
      ? candidate.start.character
      : typeof positions[0] === 'number'
        ? positions[0]
        : null;
  const endCharacter =
    typeof candidate.end?.character === 'number'
      ? candidate.end.character
      : typeof positions[1] === 'number'
        ? positions[1]
        : startCharacter;
  if (
    startCharacter === null ||
    endCharacter === null ||
    startCharacter < 0 ||
    endCharacter < startCharacter ||
    endCharacter > source.length
  ) {
    return null;
  }
  const node: AstNode = {
    type: 'SvelteParseError',
    start: startCharacter,
    end: endCharacter,
  };
  const fallback = sourceLocation(source, node);
  const point = (
    value: CompilerErrorPoint | undefined,
    fallbackPoint: SourcePosition
  ): SourcePosition => ({
    line: typeof value?.line === 'number' ? value.line : fallbackPoint.line,
    column:
      typeof value?.column === 'number' ? value.column : fallbackPoint.column,
  });
  return {
    node,
    location: {
      start: point(candidate.start, fallback.start),
      end: point(candidate.end, fallback.end),
    },
  };
}

function calleeParts(node: AstNode): {
  object: AstNode;
  property: AstNode;
  computed: boolean;
  optional: boolean;
} | null {
  if (node.type !== 'CallExpression') return null;
  const callee = childNode(node.callee);
  if (!callee || callee.type !== 'MemberExpression') return null;
  const object = childNode(callee.object);
  const property = childNode(callee.property);
  if (!object || !property) return null;
  const attrsPropertyName =
    nodeName(property) ??
    (property.type === 'Literal' && property.value === 'attrs'
      ? 'attrs'
      : null);
  if (attrsPropertyName !== 'attrs') return null;
  return {
    object,
    property,
    computed: callee.computed === true,
    optional: callee.optional === true || node.optional === true,
  };
}

interface ResolverImportAccess {
  binding: ImportBinding;
  resolver: AstNode;
  displayName: string;
  request: SvelteResolverAttributionRequest;
}

function resolverImportAccess(
  receiver: AstNode,
  bindings: ReadonlyMap<string, ImportBinding>
): ResolverImportAccess | null {
  const directName = nodeName(receiver);
  if (directName) {
    const binding = bindings.get(directName);
    if (!binding) return null;
    return {
      binding,
      resolver: receiver,
      displayName: directName,
      request: {
        source: binding.source,
        imported: binding.imported,
        local: directName,
        access: { kind: 'direct', importKind: binding.kind },
      },
    };
  }

  if (
    receiver.type !== 'MemberExpression' ||
    receiver.computed === true ||
    receiver.optional === true
  ) {
    return null;
  }
  const namespaceNode = childNode(receiver.object);
  const memberNode = childNode(receiver.property);
  const namespaceName = nodeName(namespaceNode);
  const memberName =
    nodeName(memberNode) ??
    (memberNode?.type === 'Literal' && typeof memberNode.value === 'string'
      ? memberNode.value
      : null);
  if (!namespaceNode || !namespaceName || !memberName) return null;
  const binding = bindings.get(namespaceName);
  if (!binding || binding.kind !== 'namespace') return null;
  return {
    binding,
    resolver: receiver,
    displayName: `${namespaceName}.${memberName}`,
    request: {
      source: binding.source,
      imported: memberName,
      local: namespaceName,
      access: { kind: 'namespace-member', importKind: 'namespace' },
    },
  };
}

function isSupportedResolverAccess(access: ResolverImportAccess): boolean {
  return (
    access.binding.kind === 'named' && access.request.access.kind === 'direct'
  );
}

interface ResolverCallSite {
  access: ResolverImportAccess;
  /** `badge.attrs({...})` vs the callable string form `badge({...})` —
   *  identical usage semantics (`ClassResolver` declares both), so both
   *  must witness or fail closed; only the callee shape differs. */
  form: 'attrs' | 'callable';
  computed: boolean;
  optional: boolean;
}

function resolverCallSite(
  node: AstNode,
  bindings: ReadonlyMap<string, ImportBinding>
): ResolverCallSite | null {
  if (node.type !== 'CallExpression') return null;
  const parts = calleeParts(node);
  if (parts) {
    const access = resolverImportAccess(parts.object, bindings);
    if (!access) return null;
    return {
      access,
      form: 'attrs',
      computed: parts.computed,
      optional: parts.optional,
    };
  }
  const callee = childNode(node.callee);
  if (!callee) return null;
  // Direct callable (`badge({...})`) or namespace-member callable
  // (`styles.badge({...})`): resolverImportAccess classifies both; the
  // namespace form then fails closed through the shared access gate,
  // exactly like its `.attrs` sibling.
  const access = resolverImportAccess(callee, bindings);
  if (!access) return null;
  return {
    access,
    form: 'callable',
    computed: callee.type === 'MemberExpression' && callee.computed === true,
    optional:
      node.optional === true ||
      (callee.type === 'MemberExpression' && callee.optional === true),
  };
}

function argumentSpan(argumentsList: AstNode[], fallback: AstNode): AstNode {
  if (argumentsList.length === 0) return fallback;
  return {
    type: 'ArgumentRange',
    start: argumentsList[0].start,
    end: argumentsList[argumentsList.length - 1].end,
  };
}

function propertyName(node: AstNode): string | null {
  const key = childNode(node.key);
  if (!key) return null;
  if (key.type === 'Identifier' && typeof key.name === 'string') {
    return key.name;
  }
  if (key.type === 'Literal' && typeof key.value === 'string') {
    return key.value;
  }
  return null;
}

function isJsxAttributeName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(name);
}

function tsxIncompatibleValue(value: AstNode): AstNode | null {
  let incompatible: AstNode | null = null;
  walk(value, (node) => {
    if (incompatible) return;
    if (
      node.type === 'TSTypeAssertion' ||
      (node.type === 'ArrowFunctionExpression' &&
        childNode(node.typeParameters) !== null)
    ) {
      incompatible = node;
    }
  });
  return incompatible;
}

function readProperties(
  argument: AstNode,
  source: string,
  originalPath: string
): WitnessProperty[] | SvelteAdapterDiagnostic {
  if (!Array.isArray(argument.properties)) {
    return diagnostic(
      'SVELTE_ATTRS_ARGUMENT_UNRESOLVED',
      'Resolver .attrs() requires an object literal with statically named properties.',
      originalPath,
      source,
      argument
    );
  }
  const properties: WitnessProperty[] = [];
  for (const value of argument.properties) {
    if (!isNode(value)) continue;
    if (value.type === 'SpreadElement') {
      return diagnostic(
        'SVELTE_ATTRS_SPREAD_UNRESOLVED',
        'Resolver .attrs() object spreads are unresolved; enumerate properties explicitly.',
        originalPath,
        source,
        value
      );
    }
    if (value.type !== 'Property') {
      return diagnostic(
        'SVELTE_ATTRS_PROPERTY_UNSUPPORTED',
        'Resolver .attrs() accepts ordinary object properties only.',
        originalPath,
        source,
        value
      );
    }
    if (value.computed === true) {
      return diagnostic(
        'SVELTE_ATTRS_COMPUTED_KEY',
        'Resolver .attrs() computed property names cannot be attributed safely.',
        originalPath,
        source,
        value
      );
    }
    if (value.method === true || value.kind !== 'init') {
      return diagnostic(
        'SVELTE_ATTRS_PROPERTY_UNSUPPORTED',
        'Resolver .attrs() methods and accessors cannot be projected as attributes.',
        originalPath,
        source,
        value
      );
    }
    const key = childNode(value.key);
    const propertyValue = childNode(value.value);
    const name = propertyName(value);
    if (!key || !propertyValue || !name || !isJsxAttributeName(name)) {
      return diagnostic(
        'SVELTE_ATTRS_PROPERTY_UNSUPPORTED',
        'Resolver .attrs() property names must be JSX-compatible identifier or string names.',
        originalPath,
        source,
        value
      );
    }
    const incompatibleValue = tsxIncompatibleValue(propertyValue);
    if (incompatibleValue) {
      return diagnostic(
        'SVELTE_ATTRS_VALUE_UNSUPPORTED',
        'Resolver .attrs() values using angle-bracket type assertions or generic arrow parameters cannot be projected into TSX safely.',
        originalPath,
        source,
        incompatibleValue
      );
    }
    properties.push({ name, property: value, key, value: propertyValue });
  }
  return properties;
}

class VirtualSourceBuilder {
  private chunks: string[] = [];
  private bytes = 0;
  readonly mappings: SvelteOriginMapping[] = [];

  constructor(private readonly originalSource: string) {}

  append(text: string): void {
    this.chunks.push(text);
    this.bytes += Buffer.byteLength(text);
  }

  appendMapped(
    text: string,
    kind: SvelteOriginMappingKind,
    original: AstNode
  ): void {
    const start = this.bytes;
    this.append(text);
    this.mappings.push({
      kind,
      generated: { start, end: this.bytes },
      original: byteSpan(this.originalSource, original),
    });
  }

  toString(): string {
    return this.chunks.join('');
  }
}

function importedName(specifier: AstNode): string | null {
  const imported = childNode(specifier.imported);
  if (!imported) return null;
  if (imported.type === 'Identifier' && typeof imported.name === 'string') {
    return imported.name;
  }
  if (imported.type === 'Literal' && typeof imported.value === 'string') {
    return imported.value;
  }
  return null;
}

function renderImport(
  declaration: AstNode,
  witnessedBindings: ReadonlySet<string>,
  source: string
): { text: string; locals: string[] } | null {
  if (!Array.isArray(declaration.specifiers)) return null;
  const names: string[] = [];
  const locals: string[] = [];
  for (const value of declaration.specifiers) {
    if (!isNode(value) || value.type !== 'ImportSpecifier') continue;
    const local = childNode(value.local);
    const localName = nodeName(local);
    if (!localName || !witnessedBindings.has(localName)) continue;
    names.push(source.slice(value.start, value.end));
    locals.push(localName);
  }
  if (names.length === 0) return null;
  const sourceNode = childNode(declaration.source);
  const sourceText =
    sourceNode && typeof sourceNode.raw === 'string'
      ? sourceNode.raw
      : sourceNode && typeof sourceNode.value === 'string'
        ? JSON.stringify(sourceNode.value)
        : null;
  return sourceText
    ? { text: `import { ${names.join(', ')} } from ${sourceText};\n`, locals }
    : null;
}

/** Memoizes success only: a missing optional peer retries per file, so
 *  installing `svelte` mid-session recovers without a process restart. */
let compilerMemo: SvelteCompiler | null = null;
async function loadCompiler(): Promise<SvelteCompiler | null> {
  if (compilerMemo) return compilerMemo;
  compilerMemo = (await import('svelte/compiler').catch(
    () => null
  )) as SvelteCompiler | null;
  return compilerMemo;
}

/** Module-script context an instance projection inherits: Svelte places
 *  `<script module>` bindings in scope for the instance script. */
interface InheritedModuleScope {
  bindings: ReadonlyMap<string, ImportBinding>;
  importDeclarations: readonly AstNode[];
}

function projectScope(
  script: ScriptNode,
  scope: SvelteScriptScope,
  source: string,
  originalPath: string,
  options: AdaptSvelteSourceOptions,
  inherited?: InheritedModuleScope,
  precomputedOwnBindings?: ReadonlyMap<string, ImportBinding>
): ScopeProjection {
  const ownBindings = precomputedOwnBindings ?? importBindings(script.content);
  // Own imports shadow inherited module-script bindings, matching Svelte's
  // scoping — a resolver imported in `<script module>` and called in the
  // instance script is legal and must witness, not vanish.
  const bindings = inherited
    ? new Map([...inherited.bindings, ...ownBindings])
    : ownBindings;
  const witnesses: Witness[] = [];
  const diagnostics: SvelteAdapterDiagnostic[] = [];

  // No candidate import binding can ever produce a call site, so the AST
  // walk — the scan's dominant cost — is skipped for the common component
  // that imports no `.asClass()` resolver.
  if (bindings.size > 0) walk(script.content, (node, nestedScopeDepth) => {
    const site = resolverCallSite(node, bindings);
    if (!site) return;
    const { access, form } = site;
    const attribution = options.attributeResolver(access.request);
    if (attribution === 'other') return;
    const resolverName = access.displayName;
    const callDisplay =
      form === 'attrs' ? `${resolverName}.attrs()` : `${resolverName}()`;
    if (
      attribution === 'unsupported-resolver-form' ||
      !isSupportedResolverAccess(access)
    ) {
      diagnostics.push(
        diagnostic(
          'SVELTE_ATTRS_IMPORT_UNSUPPORTED',
          `Resolver '${resolverName}' uses an import/access form that the extraction engine cannot attribute to its exported .asClass() binding.`,
          originalPath,
          source,
          access.resolver
        )
      );
      return;
    }
    if (nestedScopeDepth > 0) {
      diagnostics.push(
        diagnostic(
          'SVELTE_ATTRS_SCOPE_UNSUPPORTED',
          `Resolver '${callDisplay}' is inside a nested binding scope; move the call to the top-level script scope so its import identity is unambiguous.`,
          originalPath,
          source,
          access.resolver
        )
      );
      return;
    }
    if (site.computed || site.optional) {
      diagnostics.push(
        diagnostic(
          'SVELTE_ATTRS_CALLEE_UNSUPPORTED',
          `Resolver '${resolverName}' must be called directly as ${resolverName}(...) or ${resolverName}.attrs(...).`,
          originalPath,
          source,
          node
        )
      );
      return;
    }
    const argumentsList = Array.isArray(node.arguments)
      ? node.arguments.filter(isNode)
      : [];
    if (argumentsList.length === 0) {
      witnesses.push({
        binding: access.binding,
        resolver: access.resolver,
        properties: [],
      });
      return;
    }
    if (
      argumentsList.length !== 1 ||
      argumentsList[0].type !== 'ObjectExpression'
    ) {
      diagnostics.push(
        diagnostic(
          'SVELTE_ATTRS_ARGUMENT_UNRESOLVED',
          `Resolver '${callDisplay}' accepts no argument or one object literal in Svelte projection.`,
          originalPath,
          source,
          argumentSpan(argumentsList, node)
        )
      );
      return;
    }
    const properties = readProperties(argumentsList[0], source, originalPath);
    if (!Array.isArray(properties)) {
      diagnostics.push(properties);
      return;
    }
    witnesses.push({
      binding: access.binding,
      resolver: access.resolver,
      properties,
    });
  });

  if (diagnostics.length > 0 || witnesses.length === 0) {
    return { diagnostics };
  }

  const witnessedBindings = new Set(
    witnesses.map((witness) => nodeName(witness.binding.local)!)
  );
  const builder = new VirtualSourceBuilder(source);
  const pendingNames = new Set(witnessedBindings);
  const renderDeclarations = (declarations: Iterable<AstNode>): void => {
    for (const declaration of declarations) {
      if (declaration.type !== 'ImportDeclaration') continue;
      const rendered = renderImport(declaration, pendingNames, source);
      if (!rendered) continue;
      builder.append(rendered.text);
      for (const local of rendered.locals) pendingNames.delete(local);
    }
  };
  // Own declarations first (they shadow), then inherited module-script
  // declarations for witnessed names the instance did not import itself.
  renderDeclarations(script.content.body);
  if (inherited) renderDeclarations(inherited.importDeclarations);
  for (const witness of witnesses) {
    const resolverName = nodeName(witness.resolver)!;
    builder.append('<');
    builder.appendMapped(resolverName, 'resolver', witness.resolver);
    for (const property of witness.properties) {
      builder.append(' ');
      builder.appendMapped(property.name, 'attribute', property.key);
      builder.append('={');
      builder.appendMapped(
        source.slice(property.value.start, property.value.end),
        'value',
        property.value
      );
      builder.append('}');
    }
    builder.append(' />;\n');
  }

  return {
    diagnostics: [],
    entry: {
      scope,
      path: `${originalPath}.${scope}.tsx`,
      source: builder.toString(),
      mappings: builder.mappings,
    },
  };
}

/**
 * Project native Svelte script scopes into parser-only TSX witnesses.
 *
 * This adapter parses source, never compiler-generated runtime JavaScript.
 * Module and instance scripts project separately (module bindings are in
 * scope for the instance script, per Svelte semantics) and contribute only
 * witnessed named imports plus synthetic JSX attributes for direct resolver
 * `.attrs()` and callable-string calls. Caller-owned metadata attributes
 * candidate imports; unsupported call shapes — including resolver calls
 * written in the template fragment — fail the whole source closed.
 */
export async function adaptSvelteSource(
  source: string,
  originalPath: string,
  options: AdaptSvelteSourceOptions
): Promise<AdaptSvelteSourceResult> {
  const original = { path: originalPath, hash: contentHash(source) };
  const compiler = await loadCompiler();
  if (!compiler) {
    return { kind: 'missing-dep', original, dependency: 'svelte/compiler' };
  }

  let ast: SvelteAst;
  try {
    ast = compiler.parse(source, { filename: originalPath, modern: true });
  } catch (error) {
    const range = compilerParseErrorRange(error, source);
    return {
      kind: 'error',
      original,
      diagnostics: [
        diagnostic(
          'SVELTE_PARSE_ERROR',
          error instanceof Error ? error.message : String(error),
          originalPath,
          source,
          range?.node,
          range?.location
        ),
      ],
    };
  }

  const projections: ScopeProjection[] = [];
  // Each program's import bindings are computed ONCE here and threaded to
  // every consumer (scope projections, fragment scan) — previously each
  // recomputed its own copy per file per ingest cycle.
  const moduleBindings = ast.module
    ? importBindings(ast.module.content)
    : undefined;
  const instanceBindings = ast.instance
    ? importBindings(ast.instance.content)
    : undefined;
  const moduleScope: InheritedModuleScope | undefined =
    ast.module && moduleBindings
      ? {
          bindings: moduleBindings,
          importDeclarations: ast.module.content.body.filter(
            (declaration) => declaration.type === 'ImportDeclaration'
          ),
        }
      : undefined;
  if (ast.module) {
    projections.push(
      projectScope(
        ast.module,
        'module',
        source,
        originalPath,
        options,
        undefined,
        moduleBindings
      )
    );
  }
  if (ast.instance) {
    projections.push(
      projectScope(
        ast.instance,
        'instance',
        source,
        originalPath,
        options,
        moduleScope,
        instanceBindings
      )
    );
  }
  const diagnostics = projections.flatMap(
    (projection) => projection.diagnostics
  );

  // Template markup is not a projection surface: a resolver call written in
  // the fragment (`{...badge.attrs({...})}`, `{@const a = badge(...)}`)
  // would contribute no usage witness, and reconciliation could then prune
  // the very variant it renders. Fail closed instead of failing silent.
  if (ast.fragment) {
    const scriptBindings = instanceBindings ?? new Map<string, ImportBinding>();
    const fragmentBindings = moduleScope
      ? new Map([...moduleScope.bindings, ...scriptBindings])
      : scriptBindings;
    // Same gate as projectScope: no bindings, no possible call site.
    if (fragmentBindings.size > 0) walkFragment(ast.fragment, (node) => {
      const site = resolverCallSite(node, fragmentBindings);
      if (!site) return;
      if (options.attributeResolver(site.access.request) === 'other') return;
      diagnostics.push(
        diagnostic(
          'SVELTE_ATTRS_TEMPLATE_UNSUPPORTED',
          `Resolver '${site.access.displayName}' is called inside the template; assign the result to a const in the instance script and spread that instead.`,
          originalPath,
          source,
          node
        )
      );
    });
  }

  if (diagnostics.length > 0) {
    return { kind: 'error', original, diagnostics };
  }
  return {
    kind: 'ok',
    original,
    entries: projections.flatMap((projection) =>
      projection.entry ? [projection.entry] : []
    ),
  };
}
