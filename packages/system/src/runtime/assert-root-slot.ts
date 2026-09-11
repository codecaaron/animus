/**
 * Without a Root slot a family has no cascade source: composed child rules
 * inherit nothing and the context transport renders the empty default.
 */
export function assertRootSlot(slots: object, fnName: string): void {
  // `in` would accept an inherited or non-enumerable `Root` that the callers'
  // `Object.entries` iteration then drops from the built family.
  if (!Object.prototype.propertyIsEnumerable.call(slots, 'Root')) {
    throw new Error(
      `${fnName}(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).`
    );
  }
}
