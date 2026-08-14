import { createPlaceAnalysis, loadSnapshot } from '../places';
import { checkSnapshot } from '../places/check';
import { UsageError } from './args';

import type { WorldDelta } from '../core/world';
import type {
  InvocationRef,
  Observation,
  PlaceAnalysis,
  Snapshot,
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

export interface SessionRequest {
  id?: number | string;
  op: string;
}

export type SessionResponse =
  | {
      id?: number | string;
      ok: true;
      op: string;
      result: unknown;
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
  handle(request: unknown): SessionOutcome;
  handleLine(line: string): SessionOutcome;
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (
  request: Record<string, unknown>,
  key: string,
  op: string
): string => {
  const value = request[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new UsageError(`${op}: '${key}' must be a non-empty string`);
  }
  return value;
};

const requireNumber = (
  request: Record<string, unknown>,
  key: string,
  op: string
): number => {
  const value = request[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UsageError(`${op}: '${key}' must be a finite number`);
  }
  return value;
};

const OBSERVATION_SOURCES = ['dom', 'ssr', 'classes'] as const;

const requireObservation = (
  request: Record<string, unknown>,
  op: string
): Observation => {
  const value = request['observation'];
  if (!isRecord(value)) {
    throw new UsageError(`${op}: 'observation' must be an object`);
  }
  const source = value.source;
  if (
    typeof source !== 'string' ||
    !OBSERVATION_SOURCES.some((name) => name === source)
  ) {
    throw new UsageError(
      `${op}: observation.source must be one of ` +
        OBSERVATION_SOURCES.join(', ')
    );
  }
  return value as unknown as Observation;
};

export interface SessionOptions {
  sourceRoot?: string;
}

export const createPlacesSession = (
  artifactsDir: string,
  options: SessionOptions = {}
): PlacesSession => {
  const snapshot = loadSnapshot(artifactsDir, {
    ...(options.sourceRoot === undefined
      ? {}
      : { sourceRoot: options.sourceRoot }),
  });
  const analysis = createPlaceAnalysis(snapshot);

  /** File-scoped ops surface the correspondence refusal, never a bare null. */
  const readableInvocationAt = (
    request: Record<string, unknown>,
    op: string
  ): InvocationRef => {
    const file = requireString(request, 'file', op);
    const offset = requireNumber(request, 'offset', op);
    const structure = snapshot.structureOf(file);
    if (!structure.ok) {
      throw new RefusalError(structure.detail);
    }
    const invocation = analysis.at(file, offset);
    if (invocation === undefined) {
      throw new UsageError(
        `${op}: no component invocation in ${file} contains offset ${offset}`
      );
    }
    return invocation;
  };

  const dispatch = (op: string, request: Record<string, unknown>): unknown => {
    switch (op) {
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
        return analysis.invocationsOf(requireString(request, 'component', op));
      case 'unresolved': {
        const file = requireString(request, 'file', op);
        const structure = snapshot.structureOf(file);
        if (!structure.ok) throw new RefusalError(structure.detail);
        return analysis.unresolved(file);
      }
      case 'at':
        return readableInvocationAt(request, op);
      case 'place':
        return analysis.placeOf(readableInvocationAt(request, op));
      case 'explain': {
        const place = analysis.placeOf(readableInvocationAt(request, op));
        const at = request['at'];
        if (at !== undefined && !isRecord(at)) {
          throw new UsageError(`${op}: 'at' must be an object of bindings`);
        }
        return analysis.explain(place, {
          property: requireString(request, 'property', op),
          ...(at === undefined
            ? {}
            : { at: at as Record<string, string | number | boolean> }),
        });
      }
      case 'carry': {
        const deltas = request['deltas'];
        if (!Array.isArray(deltas) || deltas.length === 0) {
          throw new UsageError(
            `${op}: 'deltas' must be a non-empty array of world deltas`
          );
        }
        return analysis.carry(deltas as WorldDelta[], {
          component: requireString(request, 'component', op),
          property: requireString(request, 'property', op),
        });
      }
      case 'locate':
        return analysis.locate(requireObservation(request, op));
      case 'observe':
        return analysis.observe(
          analysis.placeOf(readableInvocationAt(request, op)),
          requireObservation(request, op)
        );
      default:
        throw new UsageError(
          `unknown op '${op}' — supported: ${SESSION_OPS.join(', ')}`
        );
    }
  };

  const handle = (request: unknown): SessionOutcome => {
    if (!isRecord(request) || typeof request.op !== 'string') {
      return {
        response: {
          ok: false,
          kind: 'usage',
          error: "a request is an object with an 'op' string",
        },
        close: false,
      };
    }
    const id = request.id;
    const idField =
      typeof id === 'number' || typeof id === 'string' ? { id } : {};
    const op = request.op;

    if (op === 'shutdown') {
      return {
        response: { ...idField, ok: true, op, result: { closing: true } },
        close: true,
      };
    }

    // `snapshot` answers even when stale — it is how a client learns what it
    // is talking to; every other op refuses on a dead generation.
    if (op !== 'snapshot') {
      const freshness = snapshot.revalidate();
      if (!freshness.fresh) {
        return {
          response: {
            ...idField,
            ok: false,
            kind: 'stale-snapshot',
            error:
              'the artifact set changed since this session loaded it — ' +
              'restart the session against the rebuilt artifacts',
            changed: freshness.changed,
          },
          close: false,
        };
      }
    }

    try {
      return {
        response: { ...idField, ok: true, op, result: dispatch(op, request) },
        close: false,
      };
    } catch (error) {
      if (error instanceof RefusalError) {
        return {
          response: {
            ...idField,
            ok: false,
            kind: 'refused',
            error: error.message,
          },
          close: false,
        };
      }
      const usage = error instanceof UsageError || error instanceof TypeError;
      return {
        response: {
          ...idField,
          ok: false,
          kind: usage ? 'usage' : 'environment',
          error: String((error as Error).message ?? error),
        },
        close: false,
      };
    }
  };

  const handleLine = (line: string): SessionOutcome => {
    let request: unknown;
    try {
      request = JSON.parse(line) as unknown;
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
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
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
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
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
