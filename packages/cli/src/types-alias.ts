/** Shared registry aliases for ordinary compiler declaration output.
 *
 *  Declaration emit spells a system's prop and group registries out in full
 *  wherever a component's inferred type carries them. This module finds each
 *  system declaration (the anchor), records its two registry types as
 *  structure, and replaces every structurally identical subtree elsewhere
 *  with a reference to an alias read from the anchor. Equality is structural
 *  with every name resolved to its declaration's identity — a module file or
 *  package directory plus the exported name — never printed text alone and
 *  never assignability. A subtree the matcher cannot fully resolve is left as
 *  emitted, so the rewrite can only fail to shrink a packet, not change a
 *  type. */

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  parseSync,
  rawTransferSupported,
  Visitor,
  visitorKeys,
} from 'oxc-parser';

import { UsageFailure } from './build';
import { isRelativeSpecifier, toPosix } from './types-resolve';

import type { TextEdit } from './types-map';
import type { ModuleIdentities } from './types-resolve';
import type {
  Comment,
  Declaration,
  Node,
  ParamPattern,
  ParserOptions,
  Program,
  PropertyKey,
  TSImportType,
  TSImportTypeQualifier,
  TSIntersectionType,
  TSLiteral,
  TSSignature,
  TSTupleElement,
  TSType,
  TSTypeAnnotation,
  TSTypeLiteral,
  TSTypeName,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
} from 'oxc-parser';

/** The isolated helper module, at the packet root. No user module re-exports
 *  it, so its names cannot collide with a package's own exports. */
export const ALIAS_HELPER_FILE = '__animus_registry__.d.ts';

const SYSTEM_PACKAGE = '@animus-ui/system';
const SYSTEM_TYPES = new Set(['SystemInstance', 'SealedSystemInstance']);
/** The registry type arguments of SystemInstance, in order, and the public
 *  property each is read back through. */
const REGISTRY_MEMBERS = [
  ['PR', 'propRegistry'],
  ['GR', 'groupRegistry'],
] as const;

type RegistryMember = (typeof REGISTRY_MEMBERS)[number][1];

export interface RegistryAlias {
  /** The helper module's exported name, e.g. `ds_PR`. */
  name: string;
  /** How the helper module imports the anchor, and the export it reads. */
  anchorSpecifier: string;
  anchorExport: string;
  member: RegistryMember;
  tokens: readonly string[];
}

/** A system declaration whose registries were not aliased, and why. The
 *  run goes on; it is reported, not refused. */
export interface SkippedAnchor {
  file: string;
  anchorExport: string;
  reason: string;
}

export interface AliasReplacement {
  start: number;
  end: number;
  alias: RegistryAlias;
  /** Whether the subtree named a binding of its own file (an import or a
   *  local declaration), so its text does not stand alone outside it. */
  usesFileBindings: boolean;
}

// ---------------------------------------------------------------------------
// File scope

/** Top-level bindings of one declaration file, each mapped to the identity
 *  of what it names (null: an import that does not resolve). */
class FileScope {
  readonly bindings = new Map<string, string | null>();

  constructor(
    /** The file's final absolute location. */
    readonly file: string,
    program: Program,
    readonly identities: ModuleIdentities
  ) {
    for (const statement of program.body) {
      if (statement.type === 'ImportDeclaration') {
        const target = identities.identify(statement.source.value, file);
        for (const specifier of statement.specifiers) {
          const imported =
            specifier.type === 'ImportSpecifier'
              ? moduleExportName(specifier.imported)
              : specifier.type === 'ImportDefaultSpecifier'
                ? 'default'
                : '*';
          this.bindings.set(
            specifier.local.name,
            target === null ? null : `${target}#${imported}`
          );
        }
      } else if (statement.type === 'ExportNamedDeclaration') {
        if (statement.declaration !== null)
          this.#declare(statement.declaration);
      } else if (statement.type === 'ExportDefaultDeclaration') {
        const declaration = statement.declaration;
        if (
          (declaration.type === 'FunctionDeclaration' ||
            declaration.type === 'TSDeclareFunction' ||
            declaration.type === 'ClassDeclaration' ||
            declaration.type === 'TSInterfaceDeclaration') &&
          declaration.id !== null
        ) {
          this.#local(declaration.id.name);
        }
      } else if (statement.type === 'TSImportEqualsDeclaration') {
        this.#importEquals(statement);
      } else if (isDeclaration(statement)) {
        this.#declare(statement);
      }
    }
  }

  #local(name: string): void {
    this.bindings.set(name, `local:${this.file}#${name}`);
  }

  #importEquals(
    statement: Extract<Declaration, { type: 'TSImportEqualsDeclaration' }>
  ): void {
    const moduleReference = statement.moduleReference;
    if (moduleReference.type !== 'TSExternalModuleReference') {
      this.#local(statement.id.name);
      return;
    }
    const target = this.identities.identify(
      moduleReference.expression.value,
      this.file
    );
    this.bindings.set(
      statement.id.name,
      target === null ? null : `${target}#=`
    );
  }

  #declare(declaration: Declaration): void {
    switch (declaration.type) {
      case 'VariableDeclaration':
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === 'Identifier') {
            this.#local(declarator.id.name);
          }
        }
        return;
      case 'TSModuleDeclaration':
        // `declare module 'x'` and `declare global` bind nothing here.
        if (
          declaration.id.type === 'Identifier' &&
          declaration.kind !== 'global'
        ) {
          this.#local(declaration.id.name);
        }
        return;
      case 'TSImportEqualsDeclaration':
        this.#importEquals(declaration);
        return;
      default:
        if (declaration.id !== null) this.#local(declaration.id.name);
    }
  }
}

function isDeclaration(
  statement: Program['body'][number]
): statement is Declaration {
  switch (statement.type) {
    case 'VariableDeclaration':
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
    case 'ClassDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSEnumDeclaration':
    case 'TSModuleDeclaration':
      return true;
    default:
      return false;
  }
}

function moduleExportName(
  name:
    | { type: 'Identifier'; name: string }
    | { type: 'Literal'; value: string }
): string {
  return name.type === 'Identifier' ? name.name : name.value;
}

// ---------------------------------------------------------------------------
// Structural serialization
//
// One token stream per type: node kinds, every modifier that changes the
// type, literal values, binder names, and each reference as the identity it
// resolves to. Two subtrees are interchangeable exactly when their streams
// are equal. A construct outside the supported set aborts (false), which
// keeps the subtree out of every match.

interface TokenSink {
  accept(token: string): boolean;
}

class TokenRecorder implements TokenSink {
  readonly tokens: string[] = [];
  accept(token: string): boolean {
    this.tokens.push(token);
    return true;
  }
}

class TokenComparer implements TokenSink {
  index = 0;
  constructor(readonly expected: readonly string[]) {}
  accept(token: string): boolean {
    if (this.expected[this.index] !== token) return false;
    this.index += 1;
    return true;
  }
  get complete(): boolean {
    return this.index === this.expected.length;
  }
}

interface SerializeContext {
  scope: FileScope;
  sink: TokenSink;
  /** Names a type parameter, mapped key or `infer` binds here. */
  binders: string[];
  /** Collects the `infer` names of the conditional whose extends clause is
   *  being read; null outside one. */
  inferNames: string[] | null;
  usesFileBindings: boolean;
  /** Whether a name resolved to a declaration of the file itself. */
  usesLocalBindings: boolean;
}

function serializeContext(
  scope: FileScope,
  sink: TokenSink,
  binders: string[]
): SerializeContext {
  return {
    scope,
    sink,
    binders,
    inferNames: null,
    usesFileBindings: false,
    usesLocalBindings: false,
  };
}

/** A type literal's or intersection's first token, which the matcher reads
 *  before serializing a candidate at all. */
function headToken(node: TSTypeLiteral | TSIntersectionType): string {
  return node.type === 'TSTypeLiteral'
    ? `members:${node.members.length}`
    : `TSIntersectionType:${node.types.length}`;
}

function emit(context: SerializeContext, token: string): boolean {
  return context.sink.accept(token);
}

function withBinders(
  context: SerializeContext,
  names: readonly string[],
  body: () => boolean
): boolean {
  const depth = context.binders.length;
  context.binders.push(...names);
  const ok = body();
  context.binders.length = depth;
  return ok;
}

function reference(context: SerializeContext, name: string): boolean {
  if (context.binders.includes(name)) return emit(context, `bound:${name}`);
  const bound = context.scope.bindings.get(name);
  if (bound === null) return false;
  if (bound !== undefined) {
    context.usesFileBindings = true;
    if (bound.startsWith('local:')) context.usesLocalBindings = true;
    return emit(context, bound);
  }
  return emit(context, `global:${name}`);
}

function typeName(context: SerializeContext, name: TSTypeName): boolean {
  switch (name.type) {
    case 'Identifier':
      return reference(context, name.name);
    case 'TSQualifiedName':
      return (
        typeName(context, name.left) && emit(context, `.${name.right.name}`)
      );
    case 'ThisExpression':
      return emit(context, 'this');
  }
}

function qualifier(name: TSImportTypeQualifier): string {
  return name.type === 'Identifier'
    ? name.name
    : `${qualifier(name.left)}.${name.right.name}`;
}

function importType(context: SerializeContext, node: TSImportType): boolean {
  // Import attributes can change resolution mode; leave such references be.
  if (node.options !== null) return false;
  const target = context.scope.identities.identify(
    node.source.value,
    context.scope.file
  );
  if (target === null) return false;
  return (
    emit(context, 'import') &&
    emit(context, target) &&
    emit(context, node.qualifier === null ? '' : qualifier(node.qualifier)) &&
    typeArguments(context, node.typeArguments)
  );
}

function typeArguments(
  context: SerializeContext,
  node: TSTypeParameterInstantiation | null
): boolean {
  if (node === null) return emit(context, 'args:none');
  return (
    emit(context, `args:${node.params.length}`) &&
    node.params.every((param) => type(context, param))
  );
}

function annotation(
  context: SerializeContext,
  node: TSTypeAnnotation | null | undefined
): boolean {
  if (node === null || node === undefined) return emit(context, 'type:none');
  return type(context, node.typeAnnotation);
}

function optionalType(context: SerializeContext, node: TSType | null): boolean {
  return node === null ? emit(context, 'type:none') : type(context, node);
}

function literal(context: SerializeContext, node: TSLiteral): boolean {
  switch (node.type) {
    case 'Literal': {
      if ('bigint' in node) return emit(context, `bigint:${node.bigint}`);
      if ('regex' in node) return false;
      const { value } = node;
      if (value === null) return emit(context, 'null');
      if (value === true || value === false) {
        return emit(context, `boolean:${String(value)}`);
      }
      return value === String(value)
        ? emit(context, `string:${value}`)
        : emit(context, `number:${String(value)}`);
    }
    case 'TemplateLiteral':
      // A substitution-free template literal type is its string.
      if (node.expressions.length !== 0 || node.quasis.length !== 1) {
        return false;
      }
      return node.quasis[0].value.cooked === null
        ? false
        : emit(context, `string:${node.quasis[0].value.cooked}`);
    case 'UnaryExpression':
      if (
        node.operator !== '-' ||
        node.argument.type !== 'Literal' ||
        'bigint' in node.argument ||
        node.argument.value !== Number(node.argument.value)
      ) {
        return false;
      }
      return emit(context, `number:${String(-node.argument.value)}`);
  }
}

/** A property name: `a`, `'a'` and `['a']` are one property. `1` and `'1'`
 *  name one property but give different `keyof` types, so the token keeps
 *  the key's kind. A computed reference keys on what it resolves to. */
function propertyKey(
  context: SerializeContext,
  key: PropertyKey,
  computed: boolean
): boolean {
  if (key.type === 'Literal') {
    if ('bigint' in key || 'regex' in key) return false;
    const { value } = key;
    if (value === null || value === true || value === false) return false;
    return value === String(value)
      ? emit(context, `key:string:${value}`)
      : emit(context, `key:number:${String(value)}`);
  }
  if (!computed) {
    return key.type === 'Identifier'
      ? emit(context, `key:string:${key.name}`)
      : false;
  }
  if (key.type === 'Identifier') {
    return emit(context, 'key:computed') && reference(context, key.name);
  }
  if (
    key.type === 'MemberExpression' &&
    !key.computed &&
    key.object.type === 'Identifier'
  ) {
    return (
      emit(context, 'key:computed') &&
      reference(context, key.object.name) &&
      emit(context, `.${key.property.name}`)
    );
  }
  return false;
}

function typeParameters(
  context: SerializeContext,
  node: TSTypeParameterDeclaration | null
): boolean {
  if (node === null) return emit(context, 'params:none');
  return (
    emit(context, `params:${node.params.length}`) &&
    node.params.every(
      (param) =>
        emit(context, `param:${param.name.name}`) &&
        emit(context, `in:${String(param.in)}`) &&
        emit(context, `out:${String(param.out)}`) &&
        emit(context, `const:${String(param.const)}`) &&
        optionalType(context, param.constraint) &&
        optionalType(context, param.default)
    )
  );
}

function parameters(
  context: SerializeContext,
  params: readonly ParamPattern[]
): boolean {
  if (!emit(context, `values:${params.length}`)) return false;
  for (const param of params) {
    if (param.type === 'Identifier') {
      if (
        !emit(context, `value:${param.name}`) ||
        !emit(context, `optional:${String(param.optional)}`) ||
        !annotation(context, param.typeAnnotation)
      ) {
        return false;
      }
    } else if (
      param.type === 'RestElement' &&
      param.argument.type === 'Identifier'
    ) {
      if (
        !emit(context, `rest:${param.argument.name}`) ||
        !annotation(context, param.typeAnnotation)
      ) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

interface SignatureParts {
  typeParameters: TSTypeParameterDeclaration | null;
  params: ParamPattern[];
  returnType: TSTypeAnnotation | null;
}

function signature(context: SerializeContext, node: SignatureParts): boolean {
  const names = node.typeParameters?.params.map((param) => param.name.name);
  return withBinders(
    context,
    names ?? [],
    () =>
      typeParameters(context, node.typeParameters) &&
      parameters(context, node.params) &&
      annotation(context, node.returnType)
  );
}

function member(context: SerializeContext, node: TSSignature): boolean {
  switch (node.type) {
    case 'TSPropertySignature':
      return (
        emit(context, 'property') &&
        emit(context, `optional:${String(node.optional)}`) &&
        emit(context, `readonly:${String(node.readonly)}`) &&
        propertyKey(context, node.key, node.computed) &&
        annotation(context, node.typeAnnotation)
      );
    case 'TSMethodSignature':
      return (
        emit(context, `method:${node.kind}`) &&
        emit(context, `optional:${String(node.optional)}`) &&
        propertyKey(context, node.key, node.computed) &&
        signature(context, node)
      );
    case 'TSIndexSignature':
      return (
        emit(context, 'index') &&
        emit(context, `readonly:${String(node.readonly)}`) &&
        emit(context, `static:${String(node.static)}`) &&
        emit(context, `keys:${node.parameters.length}`) &&
        node.parameters.every((parameter) =>
          annotation(context, parameter.typeAnnotation)
        ) &&
        annotation(context, node.typeAnnotation)
      );
    case 'TSCallSignatureDeclaration':
      return emit(context, 'call') && signature(context, node);
    case 'TSConstructSignatureDeclaration':
      return emit(context, 'construct') && signature(context, node);
  }
}

function type(context: SerializeContext, node: TSTupleElement): boolean {
  switch (node.type) {
    case 'TSAnyKeyword':
    case 'TSBigIntKeyword':
    case 'TSBooleanKeyword':
    case 'TSIntrinsicKeyword':
    case 'TSNeverKeyword':
    case 'TSNullKeyword':
    case 'TSNumberKeyword':
    case 'TSObjectKeyword':
    case 'TSStringKeyword':
    case 'TSSymbolKeyword':
    case 'TSUndefinedKeyword':
    case 'TSUnknownKeyword':
    case 'TSVoidKeyword':
    case 'TSThisType':
      return emit(context, node.type);
    case 'TSParenthesizedType':
      return type(context, node.typeAnnotation);
    case 'TSArrayType':
      return emit(context, node.type) && type(context, node.elementType);
    case 'TSOptionalType':
    case 'TSRestType':
      return emit(context, node.type) && type(context, node.typeAnnotation);
    case 'TSIndexedAccessType':
      return (
        emit(context, node.type) &&
        type(context, node.objectType) &&
        type(context, node.indexType)
      );
    case 'TSTypeOperator':
      return (
        emit(context, `operator:${node.operator}`) &&
        type(context, node.typeAnnotation)
      );
    case 'TSIntersectionType':
      return (
        emit(context, headToken(node)) &&
        node.types.every((part) => type(context, part))
      );
    case 'TSUnionType':
      return (
        emit(context, `${node.type}:${node.types.length}`) &&
        node.types.every((part) => type(context, part))
      );
    case 'TSTupleType':
      return (
        emit(context, `tuple:${node.elementTypes.length}`) &&
        node.elementTypes.every((element) => type(context, element))
      );
    case 'TSNamedTupleMember':
      return (
        emit(context, `label:${node.label.name}`) &&
        emit(context, `optional:${String(node.optional)}`) &&
        type(context, node.elementType)
      );
    case 'TSTypeLiteral':
      return (
        emit(context, headToken(node)) &&
        node.members.every((entry) => member(context, entry))
      );
    case 'TSLiteralType':
      return emit(context, 'literal') && literal(context, node.literal);
    case 'TSTemplateLiteralType':
      return (
        emit(context, `template:${node.types.length}`) &&
        node.quasis.every(
          (quasi) =>
            quasi.value.cooked !== null &&
            emit(context, `text:${quasi.value.cooked}`)
        ) &&
        node.types.every((part) => type(context, part))
      );
    case 'TSTypeReference':
      return (
        emit(context, 'reference') &&
        typeName(context, node.typeName) &&
        typeArguments(context, node.typeArguments)
      );
    case 'TSTypeQuery':
      return (
        emit(context, 'typeof') &&
        (node.exprName.type === 'TSImportType'
          ? importType(context, node.exprName)
          : typeName(context, node.exprName)) &&
        typeArguments(context, node.typeArguments)
      );
    case 'TSImportType':
      return importType(context, node);
    case 'TSTypePredicate':
      return (
        emit(context, `predicate:${String(node.asserts)}`) &&
        emit(
          context,
          node.parameterName.type === 'TSThisType'
            ? 'this'
            : `value:${node.parameterName.name}`
        ) &&
        annotation(context, node.typeAnnotation)
      );
    case 'TSFunctionType':
      return emit(context, 'function') && signature(context, node);
    case 'TSConstructorType':
      return (
        emit(context, `constructor:${String(node.abstract)}`) &&
        signature(context, node)
      );
    case 'TSInferType':
      context.inferNames?.push(node.typeParameter.name.name);
      return (
        emit(context, `infer:${node.typeParameter.name.name}`) &&
        optionalType(context, node.typeParameter.constraint)
      );
    case 'TSConditionalType': {
      // `infer` binds in the extends clause and the true branch only. A
      // scratch read of the clause collects its names first; a conditional
      // nested in it collects its own.
      const infers: string[] = [];
      const scratch: SerializeContext = {
        ...context,
        sink: new TokenRecorder(),
        binders: [...context.binders],
        inferNames: infers,
      };
      if (!type(scratch, node.extendsType)) return false;
      const enclosing = context.inferNames;
      if (!emit(context, 'conditional') || !type(context, node.checkType)) {
        return false;
      }
      context.inferNames = [];
      const scoped = withBinders(context, infers, () =>
        type(context, node.extendsType)
      );
      context.inferNames = enclosing;
      return (
        scoped &&
        withBinders(context, infers, () => type(context, node.trueType)) &&
        type(context, node.falseType)
      );
    }
    case 'TSMappedType':
      return (
        emit(
          context,
          `mapped:${String(node.optional)}:${String(node.readonly)}`
        ) &&
        emit(context, `param:${node.key.name}`) &&
        type(context, node.constraint) &&
        withBinders(
          context,
          [node.key.name],
          () =>
            optionalType(context, node.nameType) &&
            optionalType(context, node.typeAnnotation)
        )
      );
    case 'TSJSDocNullableType':
    case 'TSJSDocNonNullableType':
    case 'TSJSDocUnknownType':
      return false;
  }
}

// ---------------------------------------------------------------------------
// Parsing

export interface ParsedDeclaration {
  /** Packet-relative path, or the absolute path of a file outside it. */
  rel: string;
  text: string;
  program: Program;
  comments: Comment[];
  scope: FileScope;
}

// Raw transfer skips JSON deserialization of the AST. 0.153 accepts it but
// does not declare it in ParserOptions.
const PARSE_OPTIONS: ParserOptions & { experimentalRawTransfer: boolean } = {
  lang: 'dts',
  sourceType: 'module',
  astType: 'ts',
  preserveParens: false,
  experimentalRawTransfer: rawTransferSupported(),
};

/** `file` is where the declaration will be read from: by default its place
 *  in the packet. */
export function parseDeclaration(
  rel: string,
  text: string,
  identities: ModuleIdentities,
  file: string = join(identities.packetRoot, rel)
): ParsedDeclaration {
  const parsed = parseSync(rel, text, PARSE_OPTIONS);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${rel} does not parse as a declaration file: ${parsed.errors[0].message}`
    );
  }
  const program = parsed.program;
  return {
    rel,
    text,
    program,
    comments: parsed.comments,
    scope: new FileScope(file, program, identities),
  };
}

// ---------------------------------------------------------------------------
// Anchors

interface SystemDeclaration {
  exportName: string;
  registries: readonly TSType[];
  /** The declaration statement, which its own aliases must not rewrite. */
  start: number;
  end: number;
}

/** Files that could declare a system: a cheap prefilter before parsing. */
export function mayDeclareSystem(text: string): boolean {
  return text.includes('SystemInstance');
}

/** `export declare const X: SystemInstance<…>` or `SealedSystemInstance<…>`
 *  from @animus-ui/system, each with its registry type arguments. */
function findSystemDeclarations(
  parsed: ParsedDeclaration
): SystemDeclaration[] {
  const found: SystemDeclaration[] = [];
  for (const statement of parsed.program.body) {
    if (
      statement.type !== 'ExportNamedDeclaration' ||
      statement.declaration?.type !== 'VariableDeclaration'
    ) {
      continue;
    }
    for (const declarator of statement.declaration.declarations) {
      if (declarator.id.type !== 'Identifier') continue;
      const annotated = declarator.id.typeAnnotation?.typeAnnotation;
      if (annotated === undefined) continue;
      const registries = systemTypeArguments(annotated, parsed.scope);
      if (registries !== null) {
        found.push({
          exportName: declarator.id.name,
          registries,
          start: statement.start,
          end: statement.end,
        });
      }
    }
  }
  return found;
}

/** A system type's registry arguments, when `node` names SystemInstance or
 *  SealedSystemInstance of the installed @animus-ui/system by identity. */
function systemTypeArguments(
  node: TSType,
  scope: FileScope
): readonly TSType[] | null {
  const { identities, file } = scope;
  const system = identities.locatePackage(SYSTEM_PACKAGE, dirname(file));
  if (system === null || system.name !== SYSTEM_PACKAGE) return null;
  const systemModule = identities.identify(SYSTEM_PACKAGE, file);
  if (node.type === 'TSImportType') {
    return node.options === null &&
      node.qualifier?.type === 'Identifier' &&
      SYSTEM_TYPES.has(node.qualifier.name) &&
      identities.identify(node.source.value, file) === systemModule
      ? (node.typeArguments?.params ?? null)
      : null;
  }
  if (node.type === 'TSTypeReference' && node.typeName.type === 'Identifier') {
    const bound = scope.bindings.get(node.typeName.name);
    if (bound === null || bound === undefined) return null;
    const split = bound.lastIndexOf('#');
    return SYSTEM_TYPES.has(bound.slice(split + 1)) &&
      bound.slice(0, split) === systemModule
      ? (node.typeArguments?.params ?? null)
      : null;
  }
  return null;
}

/** Records a system's two registries as aliases, or says why it cannot. */
function registryAliases(
  scope: FileScope,
  specifier: string,
  exportName: string,
  registries: readonly TSType[],
  takenNames: Set<string>
): RegistryAlias[] | string {
  if (registries.length < REGISTRY_MEMBERS.length) {
    return 'its system type has no registry type arguments';
  }
  const aliases: RegistryAlias[] = [];
  for (const [index, [suffix, property]] of REGISTRY_MEMBERS.entries()) {
    const registry = registries[index];
    if (
      registry.type !== 'TSTypeLiteral' &&
      registry.type !== 'TSIntersectionType'
    ) {
      return `its ${property} is not a type literal`;
    }
    // An empty registry is `{}`, which every empty object type matches.
    if (headToken(registry).endsWith(':0')) return `its ${property} is empty`;
    const recorder = new TokenRecorder();
    if (!type(serializeContext(scope, recorder, []), registry)) {
      return `its ${property} contains a construct the matcher does not resolve`;
    }
    let name = `${exportName}_${suffix}`;
    for (let n = 2; takenNames.has(name); n += 1)
      name = `${exportName}_${suffix}${n}`;
    takenNames.add(name);
    aliases.push({
      name,
      anchorSpecifier: specifier,
      anchorExport: exportName,
      member: property,
      tokens: recorder.tokens,
    });
  }
  return aliases;
}

export interface AnchorSet {
  aliases: RegistryAlias[];
  skipped: SkippedAnchor[];
  /** Per packet file, the anchor statements its aliases must not rewrite. */
  anchorSpans: Map<string, Array<readonly [number, number]>>;
  /** The declaration file each anchor's helper import loads. */
  anchorFiles: Map<RegistryAlias, string>;
  /** The declaration file of every anchor, aliased or skipped: whose
   *  augmentations an entry's consumers expect. */
  anchorRoots: Set<string>;
}

/** The helper module's import of a packet anchor: `src/ds.d.ts` → `./src/ds.js`. */
function packetAnchorSpecifier(rel: string): string {
  return `./${rel.replace(/\.d\.(m|c)?ts$/, (_, flavor: string | undefined) => `.${flavor ?? ''}js`)}`;
}

/** Every system the packet declares, then each `<specifier>#<export>`
 *  request for one outside it. A request names a system or fails: it never
 *  silently aliases nothing. */
export function collectAnchors(
  packetCandidates: Iterable<ParsedDeclaration>,
  requests: readonly string[],
  identities: ModuleIdentities
): AnchorSet {
  const taken = new Set<string>();
  const set: AnchorSet = {
    aliases: [],
    skipped: [],
    anchorSpans: new Map(),
    anchorFiles: new Map(),
    anchorRoots: new Set(),
  };
  const add = (
    parsed: ParsedDeclaration,
    specifier: string,
    exportName: string,
    found: SystemDeclaration,
    loads: string
  ): void => {
    set.anchorRoots.add(loads);
    const recorded = registryAliases(
      parsed.scope,
      specifier,
      exportName,
      found.registries,
      taken
    );
    if (Array.isArray(recorded)) {
      set.aliases.push(...recorded);
      for (const alias of recorded) set.anchorFiles.set(alias, loads);
    } else
      set.skipped.push({
        file: parsed.rel,
        anchorExport: exportName,
        reason: recorded,
      });
  };
  for (const parsed of packetCandidates) {
    for (const found of findSystemDeclarations(parsed)) {
      const spans = set.anchorSpans.get(parsed.rel) ?? [];
      spans.push([found.start, found.end]);
      set.anchorSpans.set(parsed.rel, spans);
      add(
        parsed,
        packetAnchorSpecifier(parsed.rel),
        found.exportName,
        found,
        join(identities.packetRoot, parsed.rel)
      );
    }
  }
  for (const request of requests) {
    const hash = request.lastIndexOf('#');
    const specifier = request.slice(0, hash);
    const exportName = request.slice(hash + 1);
    if (hash <= 0 || exportName === '' || isRelativeSpecifier(specifier)) {
      throw new UsageFailure(
        `--anchor ${request} is not <package specifier>#<export>`
      );
    }
    // Resolved as the helper module, which imports it, resolves it.
    const entry = identities.resolvePackageEntry(
      specifier,
      identities.packetRoot,
      identities.modeOf(join(identities.packetRoot, ALIAS_HELPER_FILE))
    );
    const located =
      entry === null
        ? null
        : locateExportedSystem(entry, exportName, identities, 0);
    if (entry === null || located === null) {
      throw new UsageFailure(
        `--anchor ${request}: no \`export declare const\` of an @animus-ui/system ` +
          `system reaches ${entry ?? specifier} under that name`
      );
    }
    add(located.parsed, specifier, exportName, located.found, entry);
  }
  return set;
}

/** The system `name` exports from `file`, following `export { a as name }
 *  from` and `export * from` re-exports to the declaring file. */
function locateExportedSystem(
  file: string,
  name: string,
  identities: ModuleIdentities,
  depth: number
): { parsed: ParsedDeclaration; found: SystemDeclaration } | null {
  if (depth > 16) return null;
  const parsed = parseDeclaration(
    file,
    readFileSync(file, 'utf8'),
    identities,
    file
  );
  const found = findSystemDeclarations(parsed).find(
    (system) => system.exportName === name
  );
  if (found !== undefined) return { parsed, found };
  const follow = (specifier: string, local: string) => {
    if (!isRelativeSpecifier(specifier)) return null;
    const next = identities.resolveFile(resolve(dirname(file), specifier));
    return next === null
      ? null
      : locateExportedSystem(next, local, identities, depth + 1);
  };
  for (const statement of parsed.program.body) {
    if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.source !== null
    ) {
      for (const specifier of statement.specifiers) {
        if (moduleExportName(specifier.exported) !== name) continue;
        return follow(
          statement.source.value,
          moduleExportName(specifier.local)
        );
      }
    } else if (
      statement.type === 'ExportAllDeclaration' &&
      statement.exported === null
    ) {
      const reached = follow(statement.source.value, name);
      if (reached !== null) return reached;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// One pass per file: matching, import edges, augmentation

export interface DeclarationScan {
  /** Outermost subtrees identical to an alias's registry, in order. */
  replacements: AliasReplacement[];
  /** The declaration files this one imports, as emitted: packet files at
   *  their place in the packet, others where they are. */
  imports: Set<string>;
  /** The file's own import statements, which a registry naming one of its
   *  bindings needs beside it to resolve. */
  importStatements: string;
  /** Whether it changes the global scope or another module: a `declare
   *  module '…'` or `declare global` block, a script (no import or export,
   *  so every declaration is global), or a `/// <reference lib>`. */
  augments: boolean;
  /** Whether it augments `@animus-ui/system` (`Theme`, `Selectors`,
   *  `Conditions`): the augmentations every entry must reach. */
  augmentsSystem: boolean;
  /** Whether any import carries attributes or a `resolution-mode`, which
   *  can change what it resolves to: such a file is never rewritten. */
  attributed: boolean;
  /** Registry-shaped occurrences left as emitted because they name a
   *  declaration of the file itself, which no witness can stand beside. */
  localOccurrences: number;
}

type WalkChild = Node | ReadonlyArray<Node | null> | null | undefined;

function isChildList(child: WalkChild): child is ReadonlyArray<Node | null> {
  return Array.isArray(child);
}

const TRIPLE_SLASH =
  /^\/\s*<reference\s+(path|types|lib)\s*=\s*["']([^"']+)["']/;
const MODULE_SYNTAX = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
  'TSExportAssignment',
  'TSNamespaceExportDeclaration',
]);

/** Walks `parsed` once. A matched subtree is not entered: the comparison
 *  already read it, and binders inside it are scoped to it. Ambient module
 *  and namespace bodies are never matched: their own scopes can shadow the
 *  file's bindings. */
export function scanDeclaration(
  parsed: ParsedDeclaration,
  aliases: readonly RegistryAlias[],
  skipped: ReadonlyArray<readonly [number, number]> = []
): DeclarationScan {
  const { scope } = parsed;
  const scan: DeclarationScan = {
    replacements: [],
    imports: new Set(),
    importStatements: '',
    augments: false,
    augmentsSystem: false,
    attributed: false,
    localOccurrences: 0,
  };
  const edge = (specifier: string): void => {
    const target = scope.identities.resolveImport(specifier, scope.file);
    if (target !== null) scan.imports.add(target);
  };
  for (const statement of parsed.program.body) {
    if (
      statement.type === 'ImportDeclaration' ||
      statement.type === 'ExportAllDeclaration' ||
      (statement.type === 'ExportNamedDeclaration' && statement.source !== null)
    ) {
      if (statement.source !== null) edge(statement.source.value);
      if (statement.attributes.length > 0) scan.attributed = true;
      if (statement.type === 'ImportDeclaration') {
        scan.importStatements += `${parsed.text.slice(statement.start, statement.end)}\n`;
      }
    } else if (
      statement.type === 'TSImportEqualsDeclaration' &&
      statement.moduleReference.type === 'TSExternalModuleReference'
    ) {
      edge(statement.moduleReference.expression.value);
      scan.importStatements += `${parsed.text.slice(statement.start, statement.end)}\n`;
    } else if (
      statement.type === 'TSModuleDeclaration' &&
      (statement.kind === 'global' || statement.id.type === 'Literal')
    ) {
      scan.augments = true;
      if (
        statement.id.type === 'Literal' &&
        statement.id.value === SYSTEM_PACKAGE
      ) {
        scan.augmentsSystem = true;
      }
    }
  }
  if (
    !parsed.program.body.some((statement) => MODULE_SYNTAX.has(statement.type))
  ) {
    scan.augments = true;
  }
  for (const comment of parsed.comments) {
    const directive =
      comment.type === 'Line' ? TRIPLE_SLASH.exec(comment.value) : null;
    if (directive === null) continue;
    if (/resolution-mode/.test(comment.value)) scan.attributed = true;
    const [, kind, target] = directive;
    if (kind === 'lib') scan.augments = true;
    else if (kind === 'types') edge(target);
    else edge(target.startsWith('.') ? target : `./${target}`);
  }

  // Every name bound so far in the file: a superset of the binders around
  // any node, since a binder is entered before the types it scopes.
  const seenBinders = new Set<string>();
  const heads = new Set(aliases.map((alias) => alias.tokens[0]));
  let namespaceDepth = 0;
  const tryMatch = (node: TSTypeLiteral | TSIntersectionType): boolean => {
    if (
      namespaceDepth > 0 ||
      !heads.has(headToken(node)) ||
      skipped.some(([start, end]) => node.start >= start && node.end <= end)
    ) {
      return false;
    }
    for (const alias of aliases) {
      const comparer = new TokenComparer(alias.tokens);
      const context = serializeContext(scope, comparer, [...seenBinders]);
      if (type(context, node) && comparer.complete) {
        if (context.usesLocalBindings) {
          scan.localOccurrences += 1;
          return true;
        }
        scan.replacements.push({
          start: node.start,
          end: node.end,
          alias,
          usesFileBindings: context.usesFileBindings,
        });
        return true;
      }
    }
    return false;
  };
  const visit = (node: Node): void => {
    switch (node.type) {
      case 'TSTypeParameter':
        seenBinders.add(node.name.name);
        break;
      case 'TSMappedType':
        seenBinders.add(node.key.name);
        break;
      case 'TSImportType':
        edge(node.source.value);
        if (node.options !== null) scan.attributed = true;
        break;
      case 'TSTypeLiteral':
      case 'TSIntersectionType':
        if (tryMatch(node)) return;
        break;
      case 'TSModuleDeclaration':
        namespaceDepth += 1;
        visitChildren(node);
        namespaceDepth -= 1;
        return;
    }
    visitChildren(node);
  };
  const visitChildren = (node: Node): void => {
    // SAFETY: visitorKeys lists exactly the fields of each node type that
    // hold child nodes or arrays of them.
    const fields = node as Node & { readonly [key: string]: WalkChild };
    for (const key of visitorKeys[node.type] ?? []) {
      const child = fields[key];
      if (child === null || child === undefined) continue;
      if (isChildList(child)) {
        for (const item of child) if (item !== null) visit(item);
      } else {
        visit(child);
      }
    }
  };
  visit(parsed.program);
  return scan;
}

// ---------------------------------------------------------------------------
// Rewriting

/** The import a rewritten file uses to reach the helper module. */
export function helperReference(rel: string, alias: RegistryAlias): string {
  let path = toPosix(
    relative(dirname(rel), ALIAS_HELPER_FILE.replace(/\.d\.ts$/, '.js'))
  );
  if (!path.startsWith('.')) path = `./${path}`;
  return `import("${path}").${alias.name}`;
}

/** The rewritten text, and the edits a declaration map must follow. */
export interface RewrittenDeclaration {
  text: string;
  edits: TextEdit[];
}

export function rewriteDeclaration(
  rel: string,
  original: string,
  replacements: readonly AliasReplacement[]
): RewrittenDeclaration {
  let text = '';
  let cursor = 0;
  const edits: TextEdit[] = [];
  for (const replacement of replacements) {
    const replacementText = helperReference(rel, replacement.alias);
    text += original.slice(cursor, replacement.start) + replacementText;
    edits.push({
      start: replacement.start,
      end: replacement.end,
      length: replacementText.length,
    });
    cursor = replacement.end;
  }
  return { text: text + original.slice(cursor), edits };
}

/** The helper module: each alias is read from its anchor's public registry
 *  property, so the anchor's declaration stays the only spelling. */
export function helperModule(aliases: readonly RegistryAlias[]): string {
  const lines = [
    '// Generated by `animus types alias`: each registry type, read from the',
    '// system declaration that owns it. Rebuilt with the packet; do not edit.',
  ];
  for (const alias of aliases) {
    lines.push(
      `export type ${alias.name} = (typeof import("${alias.anchorSpecifier}").${alias.anchorExport})["${alias.member}"];`
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Probes

/** Every module a probe file names statically: imports, re-exports, import
 *  types and `import('…')` with a literal. */
export function probeSpecifiers(file: string, text: string): string[] {
  const parsed = parseSync(file, text, {
    lang: file.endsWith('.tsx') ? 'tsx' : 'ts',
    sourceType: 'module',
  });
  if (parsed.errors.length > 0) {
    throw new UsageFailure(
      `probe ${file} does not parse: ${parsed.errors[0].message}`
    );
  }
  const specifiers: string[] = [];
  new Visitor({
    ImportDeclaration(node) {
      specifiers.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      specifiers.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) specifiers.push(node.source.value);
    },
    TSImportType(node) {
      specifiers.push(node.source.value);
    },
    ImportExpression(node) {
      if (
        node.source.type === 'Literal' &&
        node.source.value === String(node.source.value)
      ) {
        specifiers.push(node.source.value);
      }
    },
  }).visit(parsed.program);
  return specifiers;
}
