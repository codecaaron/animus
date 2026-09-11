export interface AnimusAdapterErrorContext {
  construct?: string;
  layer?: string;
  snippet?: string;
}

const SNIPPET_LIMIT = 72;

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
