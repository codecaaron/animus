import { asRuleId } from '../core/identity';
import { createPlaceAnalysis, loadSnapshot } from '../places';
import { checkSnapshot } from '../places/check';
import { UsageError } from './args';

import type {
  DimensionDomain,
  DimensionValue,
  ScenarioPoint,
} from '../core/scenario';
import type { WorldDelta } from '../core/world';
import type {
  CarriedOutcome,
  CheckReport,
  InvocationRef,
  LocateResult,
  Observation,
  ObservedElement,
  ObserveResult,
  Place,
  PlaceAnalysis,
  PlaceExplanation,
  Snapshot,
  SnapshotFreshness,
  UnresolvedInvocation,
} from '../places';

/**
 * Warm operation (PLACES.md §6): one loaded snapshot answering many
 * questions. The protocol is JSONL — one request object per line on stdin,
 * one response object per line on stdout — so an editor or agent holds a
 * conversation without paying the artifact parse per question.
 *
 * The warmth never outlives the truth. Source files are re-read and
 * correspondence-checked per question (`structureOf`), and the artifact set
 * is revalidated per request: a rebuilt `.animus` directory turns every
 * subsequent answer into an explicit `stale-snapshot` refusal telling the
 * client to restart, never a quiet answer from a dead generation.
 */

export const SESSION_OPS = [
  'snapshot',
  'check',
  'files',
  'invocations',
  'unresolved',
  'at',
  'place',
  'explain',
  'carry',
  'locate',
  'observe',
  'shutdown',
] as const;

export type SessionOperation = (typeof SESSION_OPS)[number];

export type SessionInput =
  | null
  | boolean
  | number
  | string
  | undefined
  | readonly SessionInput[]
  | SessionInputObject;

export interface SessionInputObject {
  readonly [key: string]: SessionInput;
}

export interface SessionRequest {
  id?: number | string;
  op: string;
}

interface ParsedSessionRequest extends SessionRequest {
  fields: SessionInputObject;
}

interface SessionSnapshotResult {
  generation: string | undefined;
  programHash: string;
  sourceRoot: string;
  files: number;
  freshness: SnapshotFreshness;
}

export type SessionResult =
  | SessionSnapshotResult
  | CheckReport
  | readonly string[]
  | readonly InvocationRef[]
  | readonly UnresolvedInvocation[]
  | InvocationRef
  | Place
  | PlaceExplanation
  | readonly CarriedOutcome[]
  | LocateResult
  | ObserveResult
  | { closing: true };

export type SessionResponse =
  | {
      id?: number | string;
      ok: true;
      op: string;
      result: SessionResult;
    }
  | {
      id?: number | string;
      ok: false;
      kind: 'usage' | 'refused' | 'stale-snapshot' | 'environment';
      error: string;
      changed?: readonly string[];
    };

export interface SessionOutcome {
  response: SessionResponse;
  close: boolean;
}

export interface PlacesSession {
  snapshot: Snapshot;
  analysis: PlaceAnalysis;
  handle(request: SessionInput): SessionOutcome;
  handleLine(line: string): SessionOutcome;
}

const isSessionObject = (value: SessionInput): value is SessionInputObject =>
  Object(value) === value &&
  Object.prototype.toString.call(value) === '[object Object]';

const isSessionString = (value: SessionInput): value is string =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object String]';

const isSessionNumber = (value: SessionInput): value is number =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object Number]';

const isSessionBoolean = (value: SessionInput): value is boolean =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object Boolean]';

const isDimensionValue = (value: SessionInput): value is DimensionValue =>
  isSessionString(value) ||
  isSessionBoolean(value) ||
  (isSessionNumber(value) && Number.isFinite(value));

const parseSessionRequest = (
  value: SessionInput
): ParsedSessionRequest | undefined => {
  if (!isSessionObject(value) || !isSessionString(value.op)) return undefined;
  const request: ParsedSessionRequest = { op: value.op, fields: value };
  if (isSessionString(value.id) || isSessionNumber(value.id)) {
    request.id = value.id;
  }
  return request;
};

const requireString = (
  request: SessionInputObject,
  key: string,
  op: string
): string => {
  const value = request[key];
  if (!isSessionString(value) || value.length === 0) {
    throw new UsageError(`${op}: '${key}' must be a non-empty string`);
  }
  return value;
};

const requireNumber = (
  request: SessionInputObject,
  key: string,
  op: string
): number => {
  const value = request[key];
  if (!isSessionNumber(value) || !Number.isFinite(value)) {
    throw new UsageError(`${op}: '${key}' must be a finite number`);
  }
  return value;
};

const OBSERVATION_SOURCES = ['dom', 'ssr', 'classes'] as const;

const isObservationSource = (
  value: SessionInput
): value is Observation['source'] =>
  isSessionString(value) &&
  OBSERVATION_SOURCES.some((source) => source === value);

const parseObservedElement = (
  value: SessionInput,
  field: string,
  op: string
): ObservedElement => {
  if (!isSessionObject(value)) {
    throw new UsageError(`${op}: '${field}' must be an object`);
  }
  const element: ObservedElement = {};
  if (value.tag !== undefined) {
    if (!isSessionString(value.tag)) {
      throw new UsageError(`${op}: '${field}.tag' must be a string`);
    }
    element.tag = value.tag;
  }
  if (value.classes !== undefined) {
    if (
      !Array.isArray(value.classes) ||
      !value.classes.every(isSessionString)
    ) {
      throw new UsageError(`${op}: '${field}.classes' must be a string array`);
    }
    element.classes = value.classes;
  }
  if (value.attributes !== undefined) {
    if (!isSessionObject(value.attributes)) {
      throw new UsageError(`${op}: '${field}.attributes' must be an object`);
    }
    const attributes: Array<[string, string]> = [];
    for (const [name, attribute] of Object.entries(value.attributes)) {
      if (!isSessionString(attribute)) {
        throw new UsageError(
          `${op}: '${field}.attributes.${name}' must be a string`
        );
      }
      attributes.push([name, attribute]);
    }
    element.attributes = Object.fromEntries(attributes);
  }
  return element;
};

const requireObservation = (
  request: SessionInputObject,
  op: string
): Observation => {
  const value = request['observation'];
  if (!isSessionObject(value)) {
    throw new UsageError(`${op}: 'observation' must be an object`);
  }
  const source = value.source;
  if (!isObservationSource(source)) {
    throw new UsageError(
      `${op}: observation.source must be one of ` +
        OBSERVATION_SOURCES.join(', ')
    );
  }
  const observation: Observation = { source };
  if (value.subject !== undefined) {
    observation.subject = parseObservedElement(
      value.subject,
      'observation.subject',
      op
    );
  }
  if (value.ancestors !== undefined) {
    if (!Array.isArray(value.ancestors)) {
      throw new UsageError(`${op}: 'observation.ancestors' must be an array`);
    }
    observation.ancestors = value.ancestors.map((ancestor, index) =>
      parseObservedElement(ancestor, `observation.ancestors[${index}]`, op)
    );
  }
  if (value.completeToRoot !== undefined) {
    if (!isSessionBoolean(value.completeToRoot)) {
      throw new UsageError(
        `${op}: 'observation.completeToRoot' must be a boolean`
      );
    }
    observation.completeToRoot = value.completeToRoot;
  }
  return observation;
};

const parseScenarioPoint = (value: SessionInput, op: string): ScenarioPoint => {
  if (!isSessionObject(value)) {
    throw new UsageError(`${op}: 'at' must be an object of bindings`);
  }
  const entries: Array<[string, DimensionValue]> = [];
  for (const [dimension, binding] of Object.entries(value)) {
    if (!isDimensionValue(binding)) {
      throw new UsageError(
        `${op}: 'at.${dimension}' must be a string, boolean, or finite number`
      );
    }
    entries.push([dimension, binding]);
  }
  return Object.fromEntries(entries);
};

const parseDimensionDomain = (
  value: SessionInput,
  field: string,
  op: string
): DimensionDomain => {
  if (!isSessionObject(value) || !isSessionString(value.kind)) {
    throw new UsageError(`${op}: '${field}' must be a dimension domain`);
  }
  if (value.kind === 'finite') {
    if (!Array.isArray(value.values) || !value.values.every(isDimensionValue)) {
      throw new UsageError(
        `${op}: '${field}.values' must be an array of dimension values`
      );
    }
    return { kind: 'finite', values: value.values };
  }
  if (value.kind === 'interval') {
    if (
      !isSessionNumber(value.min) ||
      !Number.isFinite(value.min) ||
      !isSessionNumber(value.max) ||
      !Number.isFinite(value.max)
    ) {
      throw new UsageError(
        `${op}: '${field}' interval bounds must be finite numbers`
      );
    }
    return { kind: 'interval', min: value.min, max: value.max };
  }
  throw new UsageError(`${op}: '${field}.kind' is not a supported domain`);
};

const requireDeltaString = (
  delta: SessionInputObject,
  key: string,
  index: number,
  op: string
): string => {
  const value = delta[key];
  if (!isSessionString(value)) {
    throw new UsageError(`${op}: 'deltas[${index}].${key}' must be a string`);
  }
  return value;
};

const parseWorldDelta = (
  value: SessionInput,
  index: number,
  op: string
): WorldDelta => {
  if (!isSessionObject(value) || !isSessionString(value.kind)) {
    throw new UsageError(`${op}: 'deltas[${index}]' must be a world delta`);
  }
  switch (value.kind) {
    case 'remove-declaration':
      return {
        kind: value.kind,
        rule: asRuleId(requireDeltaString(value, 'rule', index, op)),
        property: requireDeltaString(value, 'property', index, op),
      };
    case 'replace-declaration':
    case 'add-declaration':
      return {
        kind: value.kind,
        rule: asRuleId(requireDeltaString(value, 'rule', index, op)),
        property: requireDeltaString(value, 'property', index, op),
        value: requireDeltaString(value, 'value', index, op),
      };
    case 'replace-token':
      return {
        kind: value.kind,
        token: requireDeltaString(value, 'token', index, op),
        value: requireDeltaString(value, 'value', index, op),
      };
    case 'force-dimension': {
      const dimensionValue = value.value;
      if (!isDimensionValue(dimensionValue)) {
        throw new UsageError(
          `${op}: 'deltas[${index}].value' must be a dimension value`
        );
      }
      return {
        kind: value.kind,
        dimension: requireDeltaString(value, 'dimension', index, op),
        value: dimensionValue,
      };
    }
    case 'pin-dimension-domain':
      return {
        kind: value.kind,
        dimension: requireDeltaString(value, 'dimension', index, op),
        domain: parseDimensionDomain(
          value.domain,
          `deltas[${index}].domain`,
          op
        ),
      };
    case 'assume': {
      const delta: WorldDelta = {
        kind: value.kind,
        assumption: requireDeltaString(value, 'assumption', index, op),
      };
      if (value.note !== undefined) {
        delta.note = requireDeltaString(value, 'note', index, op);
      }
      return delta;
    }
    default:
      throw new UsageError(
        `${op}: 'deltas[${index}].kind' is not a supported world delta`
      );
  }
};

const requireWorldDeltas = (
  request: SessionInputObject,
  op: string
): readonly WorldDelta[] => {
  const deltas = request.deltas;
  if (!Array.isArray(deltas) || deltas.length === 0) {
    throw new UsageError(
      `${op}: 'deltas' must be a non-empty array of world deltas`
    );
  }
  return deltas.map((delta, index) => parseWorldDelta(delta, index, op));
};

type SessionCommandRequest =
  | { op: 'snapshot' | 'check' | 'files' | 'shutdown' }
  | { op: 'invocations'; component: string }
  | { op: 'unresolved'; file: string }
  | { op: 'at' | 'place'; file: string; offset: number }
  | {
      op: 'explain';
      file: string;
      offset: number;
      property: string;
      at?: ScenarioPoint;
    }
  | {
      op: 'carry';
      deltas: readonly WorldDelta[];
      component: string;
      property: string;
    }
  | { op: 'locate'; observation: Observation }
  | { op: 'observe'; file: string; offset: number; observation: Observation };

const parseCommandRequest = (
  request: ParsedSessionRequest
): SessionCommandRequest => {
  const { op, fields } = request;
  switch (op) {
    case 'snapshot':
    case 'check':
    case 'files':
    case 'shutdown':
      return { op };
    case 'invocations':
      return { op, component: requireString(fields, 'component', op) };
    case 'unresolved':
      return { op, file: requireString(fields, 'file', op) };
    case 'at':
    case 'place':
      return {
        op,
        file: requireString(fields, 'file', op),
        offset: requireNumber(fields, 'offset', op),
      };
    case 'explain': {
      const command: Extract<SessionCommandRequest, { op: 'explain' }> = {
        op,
        file: requireString(fields, 'file', op),
        offset: requireNumber(fields, 'offset', op),
        property: requireString(fields, 'property', op),
      };
      if (fields.at !== undefined) {
        command.at = parseScenarioPoint(fields.at, op);
      }
      return command;
    }
    case 'carry':
      return {
        op,
        deltas: requireWorldDeltas(fields, op),
        component: requireString(fields, 'component', op),
        property: requireString(fields, 'property', op),
      };
    case 'locate':
      return { op, observation: requireObservation(fields, op) };
    case 'observe':
      return {
        op,
        file: requireString(fields, 'file', op),
        offset: requireNumber(fields, 'offset', op),
        observation: requireObservation(fields, op),
      };
    default:
      throw new UsageError(
        `unknown op '${op}' — supported: ${SESSION_OPS.join(', ')}`
      );
  }
};

export interface SessionOptions {
  sourceRoot?: string;
}

const withRequestId = (
  request: SessionRequest,
  response: SessionResponse
): SessionResponse => {
  if (request.id === undefined) return response;
  return { id: request.id, ...response };
};

export const createPlacesSession = (
  artifactsDir: string,
  options: SessionOptions = {}
): PlacesSession => {
  const snapshotOptions: SessionOptions = {};
  if (options.sourceRoot !== undefined) {
    snapshotOptions.sourceRoot = options.sourceRoot;
  }
  const snapshot = loadSnapshot(artifactsDir, snapshotOptions);
  const analysis = createPlaceAnalysis(snapshot);

  /** File-scoped ops surface the correspondence refusal, never a bare null. */
  const readableInvocationAt = (request: {
    op: string;
    file: string;
    offset: number;
  }): InvocationRef => {
    const structure = snapshot.structureOf(request.file);
    if (!structure.ok) {
      throw new RefusalError(structure.detail);
    }
    const invocation = analysis.at(request.file, request.offset);
    if (invocation === undefined) {
      throw new UsageError(
        `${request.op}: no component invocation in ${request.file} contains ` +
          `offset ${request.offset}`
      );
    }
    return invocation;
  };

  const dispatch = (request: SessionCommandRequest): SessionResult => {
    switch (request.op) {
      case 'snapshot':
        return {
          generation: snapshot.generation,
          programHash: snapshot.host.program.hash,
          sourceRoot: snapshot.sourceRoot,
          files: snapshot.files().length,
          freshness: snapshot.revalidate(),
        };
      case 'check':
        return checkSnapshot(snapshot);
      case 'files':
        return snapshot.files();
      case 'invocations':
        return analysis.invocationsOf(request.component);
      case 'unresolved': {
        const structure = snapshot.structureOf(request.file);
        if (!structure.ok) throw new RefusalError(structure.detail);
        return analysis.unresolved(request.file);
      }
      case 'at':
        return readableInvocationAt(request);
      case 'place':
        return analysis.placeOf(readableInvocationAt(request));
      case 'explain': {
        const place = analysis.placeOf(readableInvocationAt(request));
        const question: Parameters<PlaceAnalysis['explain']>[1] = {
          property: request.property,
        };
        if (request.at !== undefined) {
          question.at = request.at;
        }
        return analysis.explain(place, question);
      }
      case 'carry':
        return analysis.carry(request.deltas, {
          component: request.component,
          property: request.property,
        });
      case 'locate':
        return analysis.locate(request.observation);
      case 'observe':
        return analysis.observe(
          analysis.placeOf(readableInvocationAt(request)),
          request.observation
        );
      case 'shutdown':
        return { closing: true };
    }
  };

  const handle = (input: SessionInput): SessionOutcome => {
    const request = parseSessionRequest(input);
    if (request === undefined) {
      return {
        response: {
          ok: false,
          kind: 'usage',
          error: "a request is an object with an 'op' string",
        },
        close: false,
      };
    }
    const op = request.op;

    if (op === 'shutdown') {
      return {
        response: withRequestId(request, {
          ok: true,
          op,
          result: { closing: true },
        }),
        close: true,
      };
    }

    // `snapshot` answers even when stale — it is how a client learns what it
    // is talking to; every other op refuses on a dead generation.
    if (op !== 'snapshot') {
      const freshness = snapshot.revalidate();
      if (!freshness.fresh) {
        return {
          response: withRequestId(request, {
            ok: false,
            kind: 'stale-snapshot',
            error:
              'the artifact set changed since this session loaded it — ' +
              'restart the session against the rebuilt artifacts',
            changed: freshness.changed,
          }),
          close: false,
        };
      }
    }

    try {
      return {
        response: withRequestId(request, {
          ok: true,
          op,
          result: dispatch(parseCommandRequest(request)),
        }),
        close: false,
      };
    } catch (error) {
      if (error instanceof RefusalError) {
        return {
          response: withRequestId(request, {
            ok: false,
            kind: 'refused',
            error: error.message,
          }),
          close: false,
        };
      }
      const usage = error instanceof UsageError || error instanceof TypeError;
      let message = String(error);
      if (error instanceof Error) {
        message = error.message;
      } else if (error instanceof Object) {
        const candidate = Object.getOwnPropertyDescriptor(error, 'message');
        if (isSessionString(candidate?.value)) {
          message = String(candidate.value);
        }
      }
      return {
        response: withRequestId(request, {
          ok: false,
          kind: usage ? 'usage' : 'environment',
          error: message,
        }),
        close: false,
      };
    }
  };

  const handleLine = (line: string): SessionOutcome => {
    let request: SessionInput;
    try {
      request = JSON.parse(line);
    } catch {
      return {
        response: {
          ok: false,
          kind: 'usage',
          error: `not valid JSON: ${line.slice(0, 80)}`,
        },
        close: false,
      };
    }
    return handle(request);
  };

  return { snapshot, analysis, handle, handleLine };
};

/** A correspondence refusal — an answer about generations, not an error. */
class RefusalError extends Error {}

export interface SessionStreams {
  stdin: AsyncIterable<string | Uint8Array>;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
}

/**
 * The stream loop: JSONL in, JSONL out, human narration on stderr only.
 * Returns 0 on a clean shutdown or stdin EOF — a session that ends is not a
 * verdict.
 */
export const runSession = async (
  artifactsDir: string,
  options: SessionOptions,
  io: SessionStreams
): Promise<number> => {
  const session = createPlacesSession(artifactsDir, options);
  io.stderr.write(
    `[animus-oracle] session open — generation ` +
      `${session.snapshot.generation ?? session.snapshot.host.program.hash}, ` +
      `${session.snapshot.files().length} file(s); one JSON request per ` +
      'line, `{"op":"shutdown"}` to close\n'
  );

  const decoder = new TextDecoder();
  let buffer = '';
  const emit = (line: string): boolean => {
    const outcome = session.handleLine(line);
    io.stdout.write(`${JSON.stringify(outcome.response)}\n`);
    return outcome.close;
  };

  for await (const chunk of io.stdin) {
    buffer += chunk instanceof Uint8Array ? decoder.decode(chunk) : chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0 && emit(line)) return 0;
      newline = buffer.indexOf('\n');
    }
  }
  const trailing = buffer.trim();
  if (trailing.length > 0) emit(trailing);
  return 0;
};
