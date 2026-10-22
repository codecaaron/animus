import { isUnitlessProperty } from '@animus-ui/properties';

/** A digit run after one of these continues a word (`#b1b1b7`, `ss01`,
 *  `U+0025`), so it is not a bare number. The extractor predicts this pass
 *  with `unit_fallback_rewrites` in `crates/extractor/src/css.rs`; keep both
 *  in step. */
const WORD_CHAR = /[A-Za-z0-9_#+-]/;

/**
 * `applyUnitFallback` through the last stylesheet's blocks: no rewrite spans
 * a `}` (its value is `[^;{}]+`), so each block's result is its own, and a
 * block the last call saw is not read again. A session's development passes
 * share one, so an edit reads only the blocks it changed.
 */
export function unitFallbackMemo(): (css: string) => string {
  let kept = new Map<string, string>();
  return (css) => {
    const next = new Map<string, string>();
    let out = '';
    for (let at = 0; at < css.length;) {
      const end = css.indexOf('}', at);
      const stop = end === -1 ? css.length : end + 1;
      const block = css.slice(at, stop);
      const fixed =
        next.get(block) ?? kept.get(block) ?? applyUnitFallback(block);
      next.set(block, fixed);
      out += fixed;
      at = stop;
    }
    kept = next;
    return out;
  };
}

export function applyUnitFallback(css: string): string {
  return css.replace(
    /(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+);/g,
    (match, prop: string, value: string) => {
      // A custom property has no unit context: its writer emits final values.
      if (isUnitlessProperty(prop) || prop.startsWith('--')) return match;
      let depth = 0;
      let fixed = '';
      let i = 0;
      while (i < value.length) {
        if (value[i] === '(') {
          depth++;
          fixed += value[i];
          i++;
        } else if (value[i] === ')') {
          depth--;
          fixed += value[i];
          i++;
        } else if (depth > 0) {
          fixed += value[i];
          i++;
        } else if (value[i] === '"' || value[i] === "'") {
          let end = i + 1;
          while (end < value.length && value[end] !== value[i]) {
            end += value[end] === '\\' ? 2 : 1;
          }
          end = Math.min(end + 1, value.length);
          fixed += value.slice(i, end);
          i = end;
        } else {
          const startsToken = i === 0 || !WORD_CHAR.test(value[i - 1]);
          const numMatch = startsToken
            ? value.slice(i).match(/^([+-]?\d+\.?\d*)/)
            : null;
          if (numMatch) {
            const num = numMatch[1];
            const after = value[i + num.length];
            if (after && /[a-z%]/i.test(after)) {
              fixed += num;
            } else {
              fixed += num + 'px';
            }
            i += num.length;
          } else {
            fixed += value[i];
            i++;
          }
        }
      }
      return fixed !== value ? `${prop}:${fixed};` : match;
    }
  );
}
