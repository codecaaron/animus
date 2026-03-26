import { Highlight, type PrismTheme } from 'prism-react-renderer';

import { ds, tokens } from '../../ds';

const SyntaxPre = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    lineHeight: 'relaxed',
    p: 24,
    overflow: 'auto',
    whiteSpace: 'pre',
    m: 0,
    bg: 'background',
    borderTop: 3,
    borderColor: 'scorch',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  })
  .asElement('pre');

// Syntax colors use CSS variable references from the theme object.
// The <pre> sets data-color-mode="dark" so variables resolve to dark values.
const animusTheme: PrismTheme = {
  plain: {
    color: tokens.colors.text,
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['keyword', 'atrule'],
      style: { color: tokens.colors.primary },
    },
    {
      types: ['string', 'attr-value'],
      style: { color: tokens.colors.success },
    },
    {
      types: ['number'],
      style: { color: tokens.colors.accent },
    },
    {
      types: ['comment'],
      style: { color: tokens.colors.textMuted, fontStyle: 'italic' as const },
    },
    {
      types: ['property', 'function'],
      style: { color: tokens.colors.secondary },
    },
    {
      types: ['selector', 'class-name', 'maybe-class-name', 'tag'],
      style: { color: tokens.colors.warning },
    },
    {
      types: ['punctuation', 'operator'],
      style: { color: tokens.colors.textMuted },
    },
    {
      types: ['builtin', 'constant'],
      style: { color: tokens.colors.accent },
    },
    {
      types: ['attr-name'],
      style: { color: tokens.colors.secondary },
    },
  ],
};

type Language = 'tsx' | 'css' | 'jsx' | 'typescript';

function detectLanguage(code: string): Language {
  if (
    code.includes('@layer') ||
    code.includes('@media') ||
    /^\s*[.#]/.test(code)
  )
    return 'css';
  if (code.includes('<') && (code.includes('/>') || code.includes('</')))
    return 'tsx';
  return 'tsx';
}

export function SyntaxBlock({
  children,
  language,
}: {
  children: string;
  language?: Language;
}) {
  const code = children.trim();
  const lang = language ?? detectLanguage(code);

  return (
    <Highlight theme={animusTheme} code={code} language={lang}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <SyntaxPre data-color-mode="dark">
          {tokens.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                <span key={j} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </SyntaxPre>
      )}
    </Highlight>
  );
}
