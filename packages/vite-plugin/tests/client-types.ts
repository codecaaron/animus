/// <reference path="../client.d.ts" />
import type { FontPreload } from '../src/index';

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Served =
  (typeof import('virtual:animus/font-preloads'))['default'][number];

// Contract: the client entry's preload is the plugin's `FontPreload`, so the
// declaration, kept free of the plugin's Node types, cannot drift from what
// the module serves.
export const clientPreloadIsFontPreload: Same<Served, FontPreload> = true;
