// Multi-byte UTF-8 span-shift stress: oxc spans are BYTE offsets and all
// v2 surgery is span- or ASCII-delimiter-based — any path that mixes
// CHAR counts with BYTE spans corrupts every replacement AFTER this
// preamble. 日本語 (3-byte), emoji (4-byte), combining marks (が = か+゙).
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
