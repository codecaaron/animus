import { ds } from './ds';

// asset() inside a theme scale value: `images.texture` is inlined into this
// component's CSS and must resolve like the @font-face asset in ds.ts. It
// renders here, so the oracle-snapshotted files keep their usage facts.
export const Textured = ds
  .styles({ backgroundImage: '{images.texture}' })
  .asElement('div');

export const TexturedPreview = () => <Textured />;
