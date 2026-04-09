import { ChevronDown } from 'lucide-react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { useState } from 'react';

import { ds, tokens } from '../../ds';
import { CopyButton } from '../docs/CopyButton';

// ─── Styled Elements ─────────────────────────────────────────────

const SyntaxContainer = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  })
  .states({
    bordered: {
      border: 1,
      borderColor: 'code.border',
    },
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
  .states({
    collapsible: {
      cursor: 'pointer',
      _hover: {
        bg: '{colors.text/4}',
      },
    },
  })
  .asElement('div');

const TitleText = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 12,
    color: 'text.muted',
  })
  .asElement('span');

const FileDot = ds
  .styles({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  })
  .variant({
    prop: 'lang',
    variants: {
      tsx: { bg: 'ocean.500' },
      jsx: { bg: 'ocean.500' },
      typescript: { bg: 'ocean.500' },
      css: { bg: 'forest.500' },
      sh: { bg: 'gold.300' },
    },
  })
  .asElement('span');

const TitleBarLeft = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  })
  .asElement('div');

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
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'transparent',
    border: 'none',
    color: 'text.dim',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'mono',
    p: 0,
    width: '16px',
    height: '16px',
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
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    '&:hover [data-copy-overlay]': {
      opacity: '1',
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
    flex: 1,
    minHeight: 0,
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

const SyntaxLine = ds
  .styles({
    display: 'flex',
    alignItems: 'stretch',
    borderLeft: 2,
    borderLeftColor: 'transparent',
    transition: 'background 0.15s ease',
  })
  .variant({
    prop: 'diff',
    variants: {
      added: {
        bg: '{colors.forest.500/8}',
        borderLeftColor: 'forest.500',
      },
      removed: {
        bg: '{colors.fire.500/6}',
        borderLeftColor: 'fire.500',
      },
    },
  })
  .states({
    highlighted: {
      bg: '{colors.gold.300/8}',
      borderLeftColor: 'gold.300',
    },
  })
  .asElement('div');

const DiffMarker = ds
  .styles({
    width: '16px',
    textAlign: 'center',
    fontFamily: 'mono',
    fontSize: 11,
    lineHeight: 'relaxed',
    userSelect: 'none',
    flexShrink: 0,
  })
  .variant({
    prop: 'kind',
    variants: {
      added: { color: 'forest.500' },
      removed: { color: 'fire.500' },
      none: { color: 'transparent' },
    },
  })
  .asElement('span');

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
  .states({
    highlighted: { color: 'gold.300' },
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
  bordered = true,
  highlights,
  diffs,
}: {
  children: string;
  language?: Language;
  title?: string;
  copyable?: boolean;
  collapsible?: boolean;
  showLineNumbers?: boolean;
  bordered?: boolean;
  highlights?: number[];
  diffs?: Record<number, '+' | '-'>;
}) {
  const code = children.trim();
  const lang = language ?? detectLanguage(code);
  const [collapsed, setCollapsed] = useState(collapsible);
  const hasChrome = title || collapsible;

  return (
    <SyntaxContainer bordered={bordered}>
      {hasChrome && (
        <TitleBar
          collapsible={collapsible}
          onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
          role={collapsible ? 'button' : undefined}
          aria-expanded={collapsible ? !collapsed : undefined}
        >
          <TitleBarLeft>
            {collapsible && (
              <CollapseToggle
                type="button"
                collapsed={collapsed}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                aria-label={collapsed ? 'Expand code' : 'Collapse code'}
              >
                <ChevronDown size={12} />
              </CollapseToggle>
            )}
            {title && (
              <>
                <FileDot lang={lang} />
                <TitleText>{title}</TitleText>
              </>
            )}
          </TitleBarLeft>
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
                {tokenLines.map((line, i) => {
                  const lineNum = i + 1;
                  const isHighlighted = highlights?.includes(lineNum);
                  const diffType = diffs?.[lineNum];
                  const hasDiff = diffType === '+' || diffType === '-';
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                    <SyntaxLine
                      key={i}
                      highlighted={isHighlighted && !hasDiff}
                      diff={
                        diffType === '+'
                          ? 'added'
                          : diffType === '-'
                            ? 'removed'
                            : undefined
                      }
                      {...getLineProps({ line })}
                    >
                      {diffs && (
                        <DiffMarker
                          kind={
                            diffType === '+'
                              ? 'added'
                              : diffType === '-'
                                ? 'removed'
                                : 'none'
                          }
                        >
                          {diffType || ' '}
                        </DiffMarker>
                      )}
                      {showLineNumbers && (
                        <LineNumberSpan highlighted={isHighlighted}>
                          {lineNum}
                        </LineNumberSpan>
                      )}
                      {line.map((token, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: stable token list from syntax highlighter
                        <span key={j} {...getTokenProps({ token })} />
                      ))}
                    </SyntaxLine>
                  );
                })}
              </SyntaxPre>
            )}
          </Highlight>
        </CodeWrapper>
      )}
    </SyntaxContainer>
  );
}
