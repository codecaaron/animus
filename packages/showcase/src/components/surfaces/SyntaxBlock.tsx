import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { useState } from 'react';

import { ds, tokens } from '../../ds';
import { CopyButton } from '../docs/CopyButton';

// ─── Styled Elements ─────────────────────────────────────────────

const SyntaxContainer = ds
  .styles({
    border: 1,
    borderColor: 'code.border',
    overflow: 'hidden',
  })
  .asElement('div');

const TitleBar = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 16,
    py: 8,
    bg: 'surface',
    borderBottom: 1,
    borderBottomColor: 'code.border',
  })
  .asElement('div');

const TitleText = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    color: 'text.muted',
  })
  .asElement('span');

const TitleActions = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  })
  .asElement('div');

const LanguageLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  })
  .asElement('span');

const CollapseToggle = ds
  .styles({
    bg: 'transparent',
    border: 'none',
    color: 'text.dim',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'mono',
    p: 0,
    transition: 'transform 0.15s ease',
  })
  .states({
    collapsed: { transform: 'rotate(-90deg)' },
  })
  .asElement('button');

const CopyOverlay = ds
  .styles({
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: '0',
    transition: 'opacity 0.15s ease',
  })
  .asElement('div');

const CodeWrapper = ds
  .styles({
    position: 'relative',
    _hover: {
      '& [data-copy-overlay]': {
        opacity: '1',
      },
    },
  })
  .asElement('div');

const SyntaxPre = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    lineHeight: 'relaxed',
    p: 24,
    overflow: 'auto',
    whiteSpace: 'pre',
    m: 0,
    bg: 'code',
    borderTop: 'none',
    borderBottom: 'none',
    borderLeft: 'none',
    borderRight: 'none',
  })
  .variant({
    prop: 'chrome',
    variants: {
      true: { borderTop: 'none' },
      false: {},
    },
  })
  .asElement('pre');

const LineNumberSpan = ds
  .styles({
    color: 'text.dim',
    fontFamily: 'mono',
    fontSize: 12,
    lineHeight: 'relaxed',
    textAlign: 'right',
    userSelect: 'none',
    minWidth: '24px',
    pr: 16,
    display: 'inline-block',
  })
  .asElement('span');

// ─── Syntax Theme ────────────────────────────────────────────────

const animusTheme: PrismTheme = {
  plain: {
    color: tokens.varRef('colors.text'),
    backgroundColor: 'transparent',
  },
  styles: [
    {
      types: ['keyword', 'atrule'],
      style: { color: tokens.varRef('colors.primary') },
    },
    {
      types: ['string', 'attr-value'],
      style: { color: tokens.varRef('colors.status.success') },
    },
    {
      types: ['number'],
      style: { color: tokens.varRef('colors.accent') },
    },
    {
      types: ['comment'],
      style: {
        color: tokens.varRef('colors.text.muted'),
        fontStyle: 'italic' as const,
      },
    },
    {
      types: ['property', 'function'],
      style: { color: tokens.varRef('colors.secondary') },
    },
    {
      types: ['selector', 'class-name', 'maybe-class-name', 'tag'],
      style: { color: tokens.varRef('colors.status.warning') },
    },
    {
      types: ['punctuation', 'operator'],
      style: { color: tokens.varRef('colors.text.muted') },
    },
    {
      types: ['builtin', 'constant'],
      style: { color: tokens.varRef('colors.accent') },
    },
    {
      types: ['attr-name'],
      style: { color: tokens.varRef('colors.secondary') },
    },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────

type Language = 'tsx' | 'css' | 'jsx' | 'typescript' | 'sh';

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

// ─── Component ───────────────────────────────────────────────────

export function SyntaxBlock({
  children,
  language,
  title,
  copyable = true,
  collapsible = false,
  showLineNumbers = false,
}: {
  children: string;
  language?: Language;
  title?: string;
  copyable?: boolean;
  collapsible?: boolean;
  showLineNumbers?: boolean;
}) {
  const code = children.trim();
  const lang = language ?? detectLanguage(code);
  const [collapsed, setCollapsed] = useState(collapsible);
  const hasChrome = title || collapsible;

  return (
    <SyntaxContainer>
      {hasChrome && (
        <TitleBar>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {collapsible && (
              <CollapseToggle
                type="button"
                collapsed={collapsed}
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? 'Expand code' : 'Collapse code'}
              >
                ▼
              </CollapseToggle>
            )}
            {title && <TitleText>{title}</TitleText>}
          </div>
          <TitleActions>
            <LanguageLabel>{lang}</LanguageLabel>
            {copyable && <CopyButton text={code} size="sm" />}
          </TitleActions>
        </TitleBar>
      )}
      {!collapsed && (
        <CodeWrapper>
          {!hasChrome && copyable && (
            <CopyOverlay data-copy-overlay>
              <CopyButton text={code} size="sm" />
            </CopyOverlay>
          )}
          <Highlight theme={animusTheme} code={code} language={lang}>
            {({ tokens: tokenLines, getLineProps, getTokenProps }) => (
              <SyntaxPre chrome={hasChrome ? 'true' : 'false'}>
                {tokenLines.map((line, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                  <div key={i} {...getLineProps({ line })}>
                    {showLineNumbers && (
                      <LineNumberSpan>{i + 1}</LineNumberSpan>
                    )}
                    {line.map((token, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                      <span key={j} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </SyntaxPre>
            )}
          </Highlight>
        </CodeWrapper>
      )}
    </SyntaxContainer>
  );
}
