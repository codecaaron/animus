import { Highlight, type PrismTheme } from 'prism-react-renderer';

const wrapStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: '0.8125rem',
  lineHeight: 1.7,
  padding: '1.5rem',
  borderRadius: 0 as const,
  overflow: 'auto',
  whiteSpace: 'pre',
  margin: 0,
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-backgroundMuted)',
};

// Theme that references our CSS variables — adapts to light/dark mode
const animusTheme: PrismTheme = {
  plain: {
    color: 'var(--color-text)',
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['keyword', 'atrule'],
      style: { color: 'var(--color-primary)' },
    },
    {
      types: ['string', 'attr-value'],
      style: { color: 'var(--color-success)' },
    },
    {
      types: ['number'],
      style: { color: 'var(--color-accent)' },
    },
    {
      types: ['comment'],
      style: { color: 'var(--color-textMuted)', fontStyle: 'italic' as const },
    },
    {
      types: ['property', 'function'],
      style: { color: 'var(--color-secondary)' },
    },
    {
      types: ['selector', 'class-name', 'tag'],
      style: { color: 'var(--color-warning)' },
    },
    {
      types: ['punctuation', 'operator'],
      style: { color: 'var(--color-textMuted)' },
    },
    {
      types: ['builtin', 'constant'],
      style: { color: 'var(--color-accent)' },
    },
    {
      types: ['attr-name'],
      style: { color: 'var(--color-secondary)' },
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
        <pre style={wrapStyle}>
          {tokens.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                <span key={j} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
