import { IS_DEV } from './is-dev';

/**
 * What rendering a component that Animus did not compile does: nothing, a
 * console warning once per component, or a thrown error on every render.
 * Without compilation its classes are empty and no CSS exists for it.
 * Production stays silent until the project owner chooses its level.
 */
export const UNCOMPILED_RENDER: 'off' | 'warn' | 'error' = IS_DEV
  ? 'warn'
  : 'off';

/** A builder terminal that ran without Animus compiling it. */
export interface UncompiledDefinition {
  /** What it renders: `<button>`, a wrapped component, or class names. */
  target: string;
  /** The module that declared it, as the call stack names it. */
  origin: string | undefined;
  reported: boolean;
}

/**
 * The record a builder terminal attaches to the component it builds at
 * runtime. Only an uncompiled definition reaches a terminal: a compiled
 * one is replaced with the component's extracted classes. `undefined` when
 * uncompiled renders are not reported.
 */
export function uncompiledDefinition(
  target: string
): UncompiledDefinition | undefined {
  if (UNCOMPILED_RENDER === 'off') return undefined;
  return {
    target,
    origin: declaringModule(new Error().stack),
    reported: false,
  };
}

/**
 * Reports a render of an uncompiled definition at the configured level.
 * Defining or importing one reports nothing; only a render does.
 */
export function reportUncompiledRender(
  definition: UncompiledDefinition | undefined,
  displayName: string | undefined
): void {
  if (!definition) return;
  if (UNCOMPILED_RENDER === 'error') {
    throw new Error(uncompiledMessage(definition, displayName));
  }
  if (definition.reported) return;
  definition.reported = true;
  // oxlint-disable-next-line no-console -- intentional runtime diagnostic
  console.warn(uncompiledMessage(definition, displayName));
}

function uncompiledMessage(
  { target, origin }: UncompiledDefinition,
  displayName: string | undefined
): string {
  const component = displayName ? `${displayName} (${target})` : target;
  const pkg = origin && packageOf(origin);
  const declared = origin ? ` declared in ${origin}` : '';
  const subject = pkg ? `the package ${pkg}` : 'its module';
  return (
    `[animus:uncompiled] ${component}${declared} rendered without Animus compiling it: ` +
    `its classes are empty and no CSS exists for it. Add the Animus plugin for this ` +
    `app's host (Vite, Next.js, Rollup) so it compiles ${subject}, or build ${subject} ` +
    `with the Animus CLI.`
  );
}

/**
 * The caller of the builder terminal: the frame after the terminal's own.
 * Engines differ in frame syntax, so only `file:line:column` is read.
 */
function declaringModule(stack: string | undefined): string | undefined {
  const frames = (stack ?? '')
    .split('\n')
    .map(
      (line) => /((?:[a-z][\w+.-]*:\/\/|\/)[^\s()]+:\d+:\d+)/i.exec(line)?.[1]
    )
    .filter((frame): frame is string => frame !== undefined);
  // This function's frame, the terminal's, then the declaring module's.
  return frames[2];
}

/** The installed package a path lies in, as `node_modules` names it. */
function packageOf(path: string): string | undefined {
  return /\/node_modules\/((?:@[^/]+\/)?[^/.][^/]*)\//.exec(path)?.[1];
}
