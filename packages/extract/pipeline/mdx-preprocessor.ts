/**
 * MDX read as the JSX it renders, plus the extension sets every driver
 * imports. No MDX compiler: usage analysis needs the components and props an
 * MDX file renders, which its JSX, expressions and imports say as written.
 */

export const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mdx',
] as const;

export type DefaultExtension = (typeof DEFAULT_EXTENSIONS)[number];

/**
 * The one engine-transform file gate every driver imports — the suffixes the
 * engine's parser accepts. `.mdx` is read as `.tsx` before it.
 */
export const ENGINE_TRANSFORM_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
] as const;

const ENGINE_TRANSFORM_RE = new RegExp(
  `\\.(?:${ENGINE_TRANSFORM_EXTENSIONS.join('|')})$`
);

export function isEngineTransformExtension(path: string): boolean {
  return ENGINE_TRANSFORM_RE.test(path);
}

/** An MDX file as usage analysis reads it, or why MDX would reject it. */
export type MdxUsageSourceResult =
  | { kind: 'ok'; source: string }
  | { kind: 'error'; error: string };

/** The list items and block quotes a line's content can sit in. */
const CONTAINER = String.raw`(?:[ \t]*(?:[-*+]|\d{1,9}[.)]|>)[ \t]+)*[ \t]*`;
const block = (pattern: string, flags = 'm') =>
  new RegExp(`^${CONTAINER}${pattern}`, flags);

const TABLE_ROW = /^ {0,3}\|?.*\|.*$/m;
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*\|/m;

/** The elements markdown syntax renders, each through the provider's
 *  component of that name when it supplies one: blocks, then paragraphs,
 *  then inline elements, the order compiled MDX renders them in. A list or
 *  quote can hold any block. */
const MARKDOWN_ELEMENTS: ReadonlyArray<[string, RegExp]> = [
  // `===` and `---` under a line are setext headings.
  ['h1', new RegExp(`^${CONTAINER}#(?:\\s|$)|^ {0,3}=+[ \\t]*$`, 'm')],
  ['h2', new RegExp(`^${CONTAINER}##(?:\\s|$)|^ {0,3}-+[ \\t]*$`, 'm')],
  ['h3', block('###(?:\\s|$)')],
  ['h4', block('####(?:\\s|$)')],
  ['h5', block('#####(?:\\s|$)')],
  ['h6', block('######(?:\\s|$)')],
  ['blockquote', /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*>/m],
  ['ul', block('[-*+]\\s')],
  ['ol', block('\\d{1,9}[.)]\\s')],
  ['li', block('(?:[-*+]|\\d{1,9}[.)])\\s')],
  ['hr', block('([-*_])(?: *\\1){2,} *$')],
  ['pre', block('(?:`{3,}|~{3,})')],
  // GFM, when the host's MDX uses it.
  ['table', TABLE_ROW],
  ['thead', TABLE_DELIMITER],
  ['tbody', TABLE_DELIMITER],
  ['tr', TABLE_ROW],
  ['th', TABLE_DELIMITER],
  ['td', TABLE_ROW],
  ['p', /\S/],
  // Inline, full and collapsed links, and the definitions shortcut ones use.
  ['a', /\]\(|\]\[|^ {0,3}\[[^\]]+\]:/m],
  ['img', /!\[/],
  ['em', /(?:^|[^*])\*[^*\s]|(?:^|[^_\w])_[^_\s]/m],
  ['strong', /\*\*|__/],
  ['code', /`/],
  ['del', /~~/],
];

const FENCE = block('(`{3,}|~{3,})', '');
const ESM = /^(?:import|export)(?:[\s{*]|$)/;
const TAG_START = /[A-Za-z_$>/]/;
/** Where inline text stops being plain markdown. */
const INLINE_SPECIAL = /[\\`{<]/g;
const BACKTICKS = /`+/y;
const TAG_NAME = /[^\s/>{]*/y;
/** A JSX tag an expression renders. */
const EXPRESSION_TAG = /<([A-Za-z_$][\w$.]*)/g;

/** The names an ESM block declares: its imports' local names and the
 *  bindings its exports declare. */
function declaredNames(esm: string): Set<string> {
  const names = new Set<string>();
  for (const [, clause] of esm.matchAll(/\bimport\s+([^'"]*?)\s+from\b/g)) {
    const named = /\{([^}]*)\}/.exec(clause!)?.[1] ?? '';
    for (const entry of named.split(',')) {
      const local = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (local) names.add(local.replace(/^type\s+/, ''));
    }
    const rest = clause!.replace(/\{[^}]*\}/, '');
    for (const [, local] of rest.matchAll(
      /(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)/g
    )) {
      if (local !== 'as' && local !== 'type') names.add(local!);
    }
  }
  for (const [, name] of esm.matchAll(
    /\bexport\s+(?:const|let|var|function\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(name!);
  }
  return names;
}

/** A scan that reached text MDX would reject. */
class MdxSyntaxError extends Error {}

/**
 * Where the JavaScript expression opening at `start` (`{`) closes: past its
 * matching `}`, across strings, template literals and comments.
 */
function expressionEnd(source: string, start: number): number {
  let depth = 0;
  let at = start;
  while (at < source.length) {
    const char = source[at]!;
    if (char === '"' || char === "'") {
      at += 1;
      while (at < source.length && source[at] !== char) {
        if (source[at] === '\\') at += 1;
        at += 1;
      }
      if (at >= source.length) break;
    } else if (char === '`') {
      at += 1;
      while (at < source.length && source[at] !== '`') {
        if (source[at] === '\\') at += 1;
        else if (source.startsWith('${', at))
          at = expressionEnd(source, at + 1) - 1;
        at += 1;
      }
    } else if (source.startsWith('//', at)) {
      at = source.indexOf('\n', at);
      if (at === -1) break;
    } else if (source.startsWith('/*', at)) {
      at = source.indexOf('*/', at);
      if (at === -1) break;
      at += 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
    at += 1;
  }
  throw new MdxSyntaxError(`unclosed expression at offset ${start}`);
}

/** A JSX tag: where it ends, its name, and whether it closes an element or
 *  closes itself. */
interface MdxTag {
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

/** The JSX tag opening at `start` (`<`). */
function tagAt(source: string, start: number): MdxTag {
  let at = start + 1;
  const closing = source[at] === '/';
  if (closing) at += 1;
  TAG_NAME.lastIndex = at;
  const name = TAG_NAME.exec(source)![0];
  at += name.length;
  while (at < source.length) {
    const char = source[at]!;
    if (char === '>') {
      return { end: at + 1, name, closing, selfClosing: false };
    }
    if (source.startsWith('/>', at)) {
      return { end: at + 2, name, closing, selfClosing: true };
    }
    if (char === '{') {
      at = expressionEnd(source, at);
      continue;
    }
    if (char === '"' || char === "'") {
      at = source.indexOf(char, at + 1);
      if (at === -1) break;
    }
    at += 1;
  }
  throw new MdxSyntaxError(`unclosed tag <${name}> at offset ${start}`);
}

/** `text` with every character but a line break as a space. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/** Each maximal run of consecutive indexes below `count` that `inRun`
 *  admits, as `[first, last]`. */
function runs(
  count: number,
  inRun: (index: number) => boolean
): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  for (let index = 0; index < count; index++) {
    if (!inRun(index)) continue;
    const first = index;
    while (index + 1 < count && inRun(index + 1)) index++;
    found.push([first, index]);
  }
  return found;
}

/** Inline MDX split into what renders and what is markdown, each the
 *  length of the text, and the tags it opens with their offsets. */
interface InlineScan {
  kept: string;
  markdown: string;
  tags: Array<[name: string, offset: number]>;
}

function scanInline(text: string, filename: string): InlineScan {
  let kept = '';
  let markdown = '';
  const tags: InlineScan['tags'] = [];
  const open: string[] = [];
  let at = 0;
  const keep = (end: number) => {
    kept += text.slice(at, end);
    markdown += blank(text.slice(at, end));
    at = end;
  };
  const drop = (end: number) => {
    kept += blank(text.slice(at, end));
    markdown += text.slice(at, end);
    at = end;
  };
  while (at < text.length) {
    INLINE_SPECIAL.lastIndex = at;
    const special = INLINE_SPECIAL.exec(text);
    if (special === null) {
      drop(text.length);
      break;
    }
    drop(special.index);
    const char = text[at]!;
    if (char === '\\') {
      drop(Math.min(at + 2, text.length));
    } else if (char === '`') {
      // A code span renders its text, never JSX.
      BACKTICKS.lastIndex = at;
      const run = BACKTICKS.exec(text)![0];
      const close = text.indexOf(run, at + run.length);
      drop(close === -1 ? at + run.length : close + run.length);
    } else if (char === '{') {
      const end = expressionEnd(text, at);
      for (const match of text.slice(at, end).matchAll(EXPRESSION_TAG)) {
        tags.push([match[1]!, at + match.index]);
      }
      keep(end);
    } else if (char === '<' && TAG_START.test(text[at + 1] ?? '')) {
      const tag = tagAt(text, at);
      if (tag.closing) {
        if (open.pop() !== tag.name) {
          throw new MdxSyntaxError(
            `closing tag </${tag.name}> does not match an open element in ${filename}`
          );
        }
      } else {
        if (!tag.selfClosing) open.push(tag.name);
        if (tag.name !== '') tags.push([tag.name, at]);
      }
      keep(tag.end);
    } else {
      drop(at + 1);
    }
  }
  if (open.length > 0) {
    throw new MdxSyntaxError(
      `unclosed element <${open[open.length - 1]}> in ${filename}`
    );
  }
  return { kept, markdown, tags };
}

/**
 * An MDX file as TSX for usage analysis: its imports and exports, JSX tags
 * and `{expressions}` kept where they are written, its markdown, code and
 * frontmatter blanked, so every kept character holds its line and column.
 * Each run of content renders in a component reading the provider's
 * components as compiled MDX does: a tag the file does not import is one a
 * provider supplies, and markdown syntax renders `_components.h1` and the
 * like with no props of its own. The engine's usage scan reads these
 * shapes (`TagOrigin::Provided`).
 */
export function mdxUsageSource(
  source: string,
  filename: string
): MdxUsageSourceResult {
  try {
    return { kind: 'ok', source: mdxToTsx(source, filename) };
  } catch (err) {
    if (!(err instanceof MdxSyntaxError)) throw err;
    return { kind: 'error', error: err.message };
  }
}

function mdxToTsx(source: string, filename: string): string {
  const lines = source.split('\n');
  const esm = lines.map(() => false);
  const inline = lines.map(() => false);
  // Output lines, the markdown each line writes, and the tags it opens.
  const out = lines.map(blank);
  const markdown = lines.map(() => '');
  const tags: string[][] = lines.map(() => []);

  let line = 0;
  // Frontmatter, which MDX hosts commonly read with a remark plugin.
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close !== -1) line = close + 1;
  }
  // Block pass: fences and ESM stay out of the inline scan; every other
  // line joins one stream, as JSX can span blocks.
  let atBlockStart = true;
  while (line < lines.length) {
    const current = lines[line]!;
    const fence = FENCE.exec(current);
    if (fence) {
      const marker = fence[1]!;
      // Closed at any indent, as one inside a list item or a quote is.
      const close = new RegExp(
        `^(?:[ \\t]*>)*[ \\t]*${marker[0]}{${marker.length},}\\s*$`
      );
      // A fence renders `pre` and `code`, whichever marker opens it.
      markdown[line] = '```';
      line += 1;
      while (line < lines.length && !close.test(lines[line]!)) line += 1;
      line += 1;
      atBlockStart = false;
    } else if (atBlockStart && ESM.test(current)) {
      for (; line < lines.length && lines[line]!.trim() !== ''; line++) {
        esm[line] = true;
        out[line] = lines[line]!;
      }
    } else {
      inline[line] = true;
      atBlockStart = current.trim() === '';
      line += 1;
    }
  }

  // One inline scan over the whole file, every other line blanked: an
  // element can hold a fence.
  const scan = scanInline(
    lines.map((text, row) => (inline[row] ? text : blank(text))).join('\n'),
    filename
  );
  const kept = scan.kept.split('\n');
  const written = scan.markdown.split('\n');
  for (let row = 0; row < lines.length; row++) {
    if (!inline[row]) continue;
    out[row] = kept[row]!;
    markdown[row] = written[row]!;
  }
  let tagRow = 0;
  let lineEnd = lines[0]!.length;
  for (const [name, offset] of scan.tags) {
    while (offset > lineEnd) lineEnd += lines[++tagRow]!.length + 1;
    tags[tagRow]!.push(name);
  }

  // Each run of non-ESM lines renders in a component of its own.
  const declared = declaredNames(
    lines.filter((_, index) => esm[index]).join('\n')
  );
  const contents: string[] = [];
  for (const [start, end] of runs(lines.length, (row) => !esm[row])) {
    // Compiled MDX takes a tag the file does not declare from the provider:
    // a capitalized name, or the object a member tag reads.
    const provided = [
      ...new Set(
        tags
          .slice(start, end + 1)
          .flat()
          .filter((tag) => tag.includes('.') || /^[A-Z]/.test(tag))
          .map((tag) => tag.split('.')[0]!)
          .filter((root) => !declared.has(root))
      ),
    ];
    const md = markdown.slice(start, end + 1).join('\n');
    const elements = MARKDOWN_ELEMENTS.filter(([, test]) => test.test(md)).map(
      ([name]) => name
    );
    if (
      out
        .slice(start, end + 1)
        .join('')
        .trim() === '' &&
      elements.length === 0
    ) {
      continue;
    }
    const name = `_MDXContent${contents.length}`;
    contents.push(name);
    const defaults = elements
      .map((element) => `${element}: "${element}", `)
      .join('');
    out[start] =
      `function ${name}(props) { const _components = { ${defaults}...props.components }${provided.length ? `, { ${provided.join(', ')} } = _components` : ''}; return <>` +
      out[start];
    out[end] +=
      elements.map((element) => `<_components.${element} />`).join('') +
      '</>; }';
  }
  // As compiled MDX: the document's own default export is its layout, and
  // otherwise the provider's `wrapper` is; either renders around the content
  // with every prop the document is given.
  const content = contents.map((name) => `<${name} {...props} />`).join('');
  const layout = lines.findIndex(
    (row, index) => esm[index] && /^export\s+default\b/.test(row)
  );
  if (layout !== -1) {
    out[layout] = out[layout]!.replace(
      /^export\s+default\b/,
      'const MDXLayout ='
    );
  }
  const wrapped = `<MDXLayout {...props}>${content}</MDXLayout>`;
  const render =
    layout !== -1
      ? `return ${wrapped};`
      : `const { wrapper: MDXLayout } = props.components || {}; return MDXLayout ? ${wrapped} : <>${content}</>;`;
  return `${out.join('\n')}\nexport default function MDXContent(props = {}) { ${render} }\n/* @mdx-source: ${filename} */\n`;
}
