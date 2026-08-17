/**
 * Readers over the manifest's `fileFacts[path].usage` channel, shared by the
 * Svelte extraction tests.
 *
 * One copy: the two suites asserted on identical tag projections and each kept
 * its own, so a change to the usage encoding could be absorbed by one and
 * missed by the other.
 */

/** One usage record, modelled at the depth these assertions read: an element
 *  site and the tag identity written at it. Non-element usage records (and
 *  elements whose tag is not a bare identifier) carry no tag and contribute
 *  nothing. */
export interface UsageFactRecord {
  element?: { tag?: { ident?: string } };
}

/** The tag identities used in one file, in emission order. */
export function usageTags(fileFacts: { usage: UsageFactRecord[] }): string[] {
  return fileFacts.usage.flatMap((fact) =>
    fact.element?.tag?.ident ? [fact.element.tag.ident] : []
  );
}
