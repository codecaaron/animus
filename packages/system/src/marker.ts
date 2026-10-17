/**
 * A state of the marked element: a pseudo-class (`:hover`) or an attribute
 * selector (`[data-state="open"]`).
 */
type MarkerState = `:${string}` | `[${string}]`;

/**
 * A named marker for relative-state selectors. Put `className` on the
 * element whose state matters, and register a relation as a selector alias:
 *
 *     export const row = marker('row');
 *     createSystem().addSelectors({ _rowHover: row.ancestor(':hover') });
 *     <tr className={row.className}><Cell _rowHover={{ opacity: 1 }} /></tr>
 *
 * Each relation wraps the marker in `:where()`, so it adds no specificity
 * beyond the component's class: a state of the element itself, such as
 * `_hover`, wins over a relative one at equal order.
 */
export interface Marker {
  /** `animus-marker-{name}`, the class the marked element carries. */
  readonly className: string;
  /** Styles an element inside a marked element in `state`. */
  ancestor(state: MarkerState): string;
  /** Styles an element holding a marked element in `state` (`:has()`). */
  descendant(state: MarkerState): string;
  /** Styles an element after a marked sibling in `state`. */
  siblingBefore(state: MarkerState): string;
  /** Styles an element before a marked sibling in `state` (`:has()`). */
  siblingAfter(state: MarkerState): string;
  /** Styles an element with a marked sibling in `state`, either side. */
  anySibling(state: MarkerState): string;
}

const MARKER_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The marked element in `state`: a pseudo-element or an unclosed
 *  attribute selector throws. */
function markedIn(className: string, state: string): string {
  const pseudoClass = state.startsWith(':') && !state.startsWith('::');
  const attribute = state.startsWith('[') && state.endsWith(']');
  if (!pseudoClass && !attribute) {
    throw new TypeError(
      `marker: "${state}" is no state — pass a pseudo-class (":hover") or an ` +
        'attribute selector ("[data-open]"); a pseudo-element is no state.'
    );
  }
  return `.${className}${state}`;
}

/** A marker named `name`: a letter, then letters, digits, `_` or `-`. */
export function marker(name: string): Marker {
  if (!MARKER_NAME.test(name)) {
    throw new TypeError(
      `marker: "${name}" is no marker name — start with a letter, then ` +
        'letters, digits, "_" or "-".'
    );
  }
  const className = `animus-marker-${name}`;
  return {
    className,
    ancestor: (state) => `&:where(${markedIn(className, state)} *)`,
    descendant: (state) => `&:where(:has(${markedIn(className, state)}))`,
    siblingBefore: (state) => `&:where(${markedIn(className, state)} ~ *)`,
    siblingAfter: (state) => `&:where(:has(~ ${markedIn(className, state)}))`,
    anySibling: (state) => {
      const marked = markedIn(className, state);
      return `&:where(${marked} ~ *, :has(~ ${marked}))`;
    },
  };
}
