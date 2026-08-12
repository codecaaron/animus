/**
 * The adapter's single failure channel.
 *
 * DESIGN §8 forbids silent approximation, and an adapter is where the
 * temptation lives: a construct the parser does not recognise is trivially
 * skippable, and the universe still *looks* complete. It is not — every later
 * "PROVED" would then be proved over a smaller world than the one it names,
 * with nothing in the answer saying so. So an unmodeled construct throws here,
 * naming the construct, the layer it was found in, and the text it choked on.
 * The only artifacts constructs that are tolerated-and-catalogued instead of
 * modeled are `@keyframes`, `@font-face` and `@layer` statements, which carry
 * no rule the cascade can resolve.
 */
export interface AnimusAdapterErrorContext {
  /** The unmodeled construct, spelled as it appears (`@scope`, `!weird`). */
  construct?: string;
  /** Emission layer or artifact section the failure came from. */
  layer?: string;
  /** A short, whitespace-collapsed excerpt of the offending text. */
  snippet?: string;
}

const SNIPPET_LIMIT = 72;

/** Collapse whitespace and clip, so an error message stays one line. */
export const excerpt = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= SNIPPET_LIMIT
    ? collapsed
    : `${collapsed.slice(0, SNIPPET_LIMIT)}…`;
};

export class AnimusAdapterError extends Error {
  readonly construct?: string;

  readonly layer?: string;

  readonly snippet?: string;

  constructor(message: string, context: AnimusAdapterErrorContext = {}) {
    const parts: string[] = [];
    if (context.layer !== undefined) parts.push(`layer=${context.layer}`);
    if (context.construct !== undefined) {
      parts.push(`construct=${context.construct}`);
    }
    if (context.snippet !== undefined) {
      parts.push(`near=${excerpt(context.snippet)}`);
    }

    super(parts.length === 0 ? message : `${message} [${parts.join(' ')}]`);
    this.name = 'AnimusAdapterError';
    this.construct = context.construct;
    this.layer = context.layer;
    this.snippet =
      context.snippet === undefined ? undefined : excerpt(context.snippet);
  }
}
