import { ds } from '../setup';

export const PxPl = ds.styles({ px: 8, pl: 4 }).asElement('div');

export const PyPt = ds.styles({ py: 8, pt: 16 }).asElement('div');

export const PxPyPt = ds.styles({ px: 4, py: 4, pt: 8 }).asElement('div');

export const PPx = ds.styles({ p: 16, px: 8 }).asElement('div');

export const PPxPl = ds.styles({ p: 16, px: 8, pl: 4 }).asElement('div');

export const PPxPyPtPb = ds
  .styles({ p: 16, px: 8, py: 8, pt: 4, pb: 24 })
  .asElement('div');

export const MxMl = ds.styles({ mx: 8, ml: 4 }).asElement('div');

export const MyMt = ds.styles({ my: 8, mt: 16 }).asElement('div');

export const MMxMl = ds.styles({ m: 16, mx: 8, ml: 4 }).asElement('div');
