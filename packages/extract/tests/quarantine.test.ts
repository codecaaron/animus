import { describe, expect, it } from 'vitest';

import { ANIMUS_LAYERS } from '../pipeline/assemble-stylesheet';
import { withVendorLayer } from '../pipeline/quarantine';

describe('quarantine: the layer order', () => {
  // Contract: `anm-vendor` comes first in the order Animus's own stylesheet
  // declares, below every Animus and consumer layer, unless the consumer's
  // `layers` list places it.
  it('puts anm-vendor first unless layers place it', () => {
    expect(withVendorLayer(undefined)).toEqual([
      'anm-vendor',
      ...ANIMUS_LAYERS,
    ]);
    expect(withVendorLayer(['reset', ...ANIMUS_LAYERS])).toEqual([
      'anm-vendor',
      'reset',
      ...ANIMUS_LAYERS,
    ]);
    const placed = ['reset', 'anm-vendor', ...ANIMUS_LAYERS];
    expect(withVendorLayer(placed)).toEqual(placed);
  });
});
