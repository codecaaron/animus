/** A slice of the manifest usage record: only the element tag identity these
 *  assertions read. Usage without a bare-identifier tag carries none. */
export interface UsageFactRecord {
  element?: { tag?: { ident?: string } };
}

export function usageTags(fileFacts: { usage: UsageFactRecord[] }): string[] {
  return fileFacts.usage.flatMap((fact) =>
    fact.element?.tag?.ident ? [fact.element.tag.ident] : []
  );
}
