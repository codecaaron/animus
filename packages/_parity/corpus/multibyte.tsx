// oxc spans are BYTE offsets: a path that mixes char counts with byte spans
// corrupts every replacement after the multi-byte text below.
const label = '日本語ラベル';
const がんばって = '頑張って 🔥🔥';
export const 見出し = ds
  .styles({ display: 'flex', content: '"こんにちは"' })
  .asElement('div');
export const Tail = ds.styles({ p: 4, content: `"${'絵文字🎌'}"` }).asElement('span');
export const App = () => (
  <div title={label} aria-label={がんばって}>
    <見出し>日本語テキスト 🗾</見出し>
    <Tail />
  </div>
);
