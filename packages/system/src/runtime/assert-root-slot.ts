/**
 * The Root-slot precondition shared by every composition entry point — the two
 * source forms (`compose`, `composeWithContext`) and the two extracted forms
 * the transform emitter writes in their place (`createComposedFamily`,
 * `createComposedFamilyWithContext`).
 *
 * A family without a Root slot has no cascade source: the composed variant
 * rules emitted for its children inherit nothing, and the context transport
 * renders them against the empty default — the silent-drop failure mode this
 * runtime guards against. Source form and extracted form must agree on the
 * contract, so the check and its message live here once.
 *
 * React-free by design: the extracted forms import it from the same module the
 * source forms do, with no cycle through the component runtime.
 */
export function assertRootSlot(slots: object, fnName: string): void {
  if (!('Root' in slots)) {
    throw new Error(
      `${fnName}(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).`
    );
  }
}
