import { useState, useEffect, useCallback } from 'react';

import { ds } from '../../ds';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';

// ─── Layer Colors ───────────────────────────────────────────────
// Per-layer accent colors as CSS var refs — used via style prop (SNOWFLAKE: data-driven)
const LAYER_TOKENS = [
  'var(--colors-text-dim)',
  'var(--colors-ocean-500)',
  'var(--colors-violet-400)',
  'var(--colors-gold-300)',
  'var(--colors-forest-500)',
  'var(--colors-fire-500)',
];

// ─── Layout ─────────────────────────────────────────────────────

const CascadeGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
    minHeight: '380px',
  })
  .asElement('div');

// ─── Strata Column (Left) ───────────────────────────────────────

const StrataColumn = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    borderRight: 1,
    borderRightColor: 'border',
    bg: 'surface',
  })
  .asElement('nav');

const StrataRow = ds
  .styles({
    display: 'flex',
    alignItems: 'stretch',
    cursor: 'pointer',
    borderLeft: 3,
    borderLeftColor: 'transparent',
    transition: 'all 0.2s ease',
    '&:hover': {
      bg: '{colors.text/3}',
    },
  })
  .asElement('div');

const StrataIndex = ds
  .styles({
    width: '44px',
    py: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
  })
  .asElement('div');

const IndexLabel = ds
  .styles({
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'mono',
    letterSpacing: '0.06em',
    transition: 'color 0.2s',
    color: 'text.dim',
  })
  .asElement('span');

const SpecDots = ds
  .styles({
    display: 'flex',
    gap: 2,
  })
  .asElement('div');

const Dot = ds
  .styles({
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    bg: '{colors.text/8}',
    transition: 'background 0.2s',
  })
  .asElement('span');

const StrataContent = ds
  .styles({
    flex: 1,
    py: 12,
    pr: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderBottom: 1,
    borderBottomColor: 'border',
    justifyContent: 'center',
  })
  .asElement('div');

const StrataTop = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  })
  .asElement('div');

const MethodLabel = ds
  .styles({
    fontSize: 13,
    fontFamily: 'mono',
    color: 'text.dim',
    transition: 'color 0.2s',
  })
  .states({
    active: {
      fontWeight: 600,
      color: 'text',
    },
  })
  .asElement('code');

const LayerBadge = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    px: 6,
    py: 1,
    fontWeight: 500,
    letterSpacing: '0.04em',
    flexShrink: 0,
    transition: 'all 0.2s',
    border: 1,
    borderColor: 'border',
    bg: 'surface',
    color: 'text.dim',
  })
  .asElement('span');

const RepeatableBadge = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    px: 6,
    py: 1,
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    color: 'text.dim',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    flexShrink: 0,
  })
  .asElement('span');

const InlineDesc = ds
  .styles({
    fontSize: 11,
    fontFamily: 'body',
    color: 'text.dim',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  .asElement('span');

const SpecificityFooter = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 12,
    py: 8,
    fontSize: 11,
    fontFamily: 'mono',
    color: 'text.dim',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    mt: 'auto',
    borderTop: 1,
    borderTopColor: 'border',
  })
  .asElement('div');

// ─── Detail Panel (Right) ───────────────────────────────────────

const DetailPanel = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  })
  .asElement('div');

const DetailHeader = ds
  .styles({
    px: 24,
    py: 20,
    borderBottom: 1,
    borderBottomColor: 'border',
  })
  .asElement('div');

const DetailHeaderTop = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    mb: 12,
  })
  .asElement('div');

const DetailMethodName = ds
  .styles({
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'mono',
    color: 'text',
  })
  .asElement('code');

const DetailAvailable = ds
  .styles({
    fontSize: 11,
    fontFamily: 'body',
    color: 'text.dim',
    fontStyle: 'italic',
  })
  .asElement('span');

const DetailDescription = ds
  .styles({
    fontFamily: 'body',
    fontSize: 13,
    color: 'text.muted',
    m: 0,
    lineHeight: 'relaxed',
  })
  .asElement('p');

const DetailSection = ds
  .styles({
    px: 24,
    py: 16,
  })
  .asElement('div');

const DetailSectionLabel = ds
  .styles({
    fontSize: 11,
    fontFamily: 'body',
    fontWeight: 600,
    color: 'text.dim',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    mb: 12,
  })
  .asElement('div');

const DetailCodeFrame = ds
  .styles({
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
  })
  .asElement('div');

// ─── Cascade Resolution ─────────────────────────────────────────

const ResolutionList = ds
  .styles({
    border: 1,
    borderColor: 'border',
    bg: 'bg',
    p: 12,
  })
  .asElement('div');

const ResolutionRow = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    py: 4,
  })
  .asElement('div');

const ResolutionDot = ds
  .styles({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  })
  .asElement('span');

const ResolutionLabel = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
  })
  .states({
    winner: {
      color: 'text',
      fontWeight: 600,
    },
    overridden: {
      color: 'text.dim',
      textDecoration: 'line-through',
    },
  })
  .asElement('code');

const ResolutionStatus = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  })
  .states({
    winner: { color: 'primary' },
    overridden: { color: 'text.dim' },
  })
  .asElement('span');

// ─── Empty State ────────────────────────────────────────────────

const EmptyDetail = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
    color: 'text.dim',
  })
  .asElement('div');

const EmptyTitle = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    color: 'text.muted',
  })
  .asElement('span');

const EmptyHint = ds
  .styles({
    fontFamily: 'body',
    fontSize: 12,
    color: 'text.dim',
  })
  .asElement('span');

const Kbd = ds
  .styles({
    px: 4,
    py: 1,
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    fontSize: 11,
    fontFamily: 'mono',
    color: 'text.dim',
  })
  .asElement('kbd');

// ─── Component ──────────────────────────────────────────────────

export interface Step {
  label: string;
  layer: string;
  description?: string;
  code?: string;
  repeatable?: boolean;
  available?: string;
}

export function ChainStep({
  steps,
  activeStep: controlledActive,
  onStepClick: controlledClick,
}: {
  steps: Step[];
  activeStep?: number;
  onStepClick?: (index: number) => void;
}) {
  const [internalActive, setInternalActive] = useState(-1);
  const isControlled = controlledActive !== undefined;
  const activeStep = isControlled ? controlledActive : internalActive;

  const handleClick = useCallback(
    (i: number) => {
      if (isControlled && controlledClick) {
        controlledClick(i);
      } else {
        setInternalActive((prev) => (prev === i ? -1 : i));
      }
    },
    [isControlled, controlledClick]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (isControlled && controlledClick) {
          controlledClick(Math.min((activeStep < 0 ? -1 : activeStep) + 1, steps.length - 1));
        } else {
          setInternalActive((p) =>
            Math.min((p < 0 ? -1 : p) + 1, steps.length - 1)
          );
        }
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (isControlled && controlledClick) {
          controlledClick(activeStep <= 0 ? -1 : activeStep - 1);
        } else {
          setInternalActive((p) => (p <= 0 ? -1 : p - 1));
        }
      }
      if (e.key === 'Escape') {
        if (isControlled && controlledClick) {
          controlledClick(-1);
        } else {
          setInternalActive(-1);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isControlled, controlledClick, activeStep, steps.length]);

  const step = activeStep >= 0 ? steps[activeStep] : null;
  const activeColor = activeStep >= 0 ? LAYER_TOKENS[activeStep % LAYER_TOKENS.length] : undefined;

  return (
    <CascadeGrid>
      {/* Strata column — left */}
      <StrataColumn>
        {steps.map((s, i) => {
          const isActive = i === activeStep;
          const color = LAYER_TOKENS[i % LAYER_TOKENS.length];
          return (
            <StrataRow
              key={s.label}
              onClick={() => handleClick(i)}
              style={{
                borderLeftColor: isActive ? color : undefined,
                background: isActive ? `color-mix(in srgb, ${color} 5%, transparent)` : undefined,
              }}
            >
              <StrataIndex>
                <IndexLabel style={{ color: isActive ? color : undefined }}>
                  L{i}
                </IndexLabel>
                <SpecDots>
                  {Array.from({ length: i + 1 }).map((_, j) => (
                    <Dot
                      key={j}
                      style={isActive ? { background: color } : undefined}
                    />
                  ))}
                </SpecDots>
              </StrataIndex>

              <StrataContent>
                <StrataTop>
                  <MethodLabel active={isActive}>{s.label}</MethodLabel>
                  <LayerBadge
                    style={
                      isActive
                        ? {
                            color,
                            background: `color-mix(in srgb, ${color} 10%, transparent)`,
                            borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    @layer {s.layer}
                  </LayerBadge>
                </StrataTop>
                {s.description && (
                  <InlineDesc>{s.description.split('.')[0]}</InlineDesc>
                )}
              </StrataContent>
            </StrataRow>
          );
        })}

        <SpecificityFooter>
          <span>↑ low</span>
          <span>high ↓</span>
        </SpecificityFooter>
      </StrataColumn>

      {/* Detail panel — right */}
      <DetailPanel>
        {step && activeColor ? (
          <>
            <DetailHeader>
              <DetailHeaderTop>
                <DetailMethodName style={{ color: activeColor }}>
                  {step.label}
                </DetailMethodName>
                <LayerBadge
                  style={{
                    color: activeColor,
                    background: `color-mix(in srgb, ${activeColor} 10%, transparent)`,
                    borderColor: `color-mix(in srgb, ${activeColor} 25%, transparent)`,
                  }}
                >
                  @layer {step.layer}
                </LayerBadge>
                {step.available && (
                  <DetailAvailable>{step.available}</DetailAvailable>
                )}
              </DetailHeaderTop>
              {step.description && (
                <DetailDescription>{step.description}</DetailDescription>
              )}
            </DetailHeader>

            {step.code && (
              <DetailSection>
                <DetailSectionLabel>Usage</DetailSectionLabel>
                <DetailCodeFrame>
                  <SyntaxBlock language="tsx" bordered={false}>
                    {step.code}
                  </SyntaxBlock>
                </DetailCodeFrame>
              </DetailSection>
            )}

            <DetailSection>
              <DetailSectionLabel>Cascade Resolution</DetailSectionLabel>
              <ResolutionList>
                {steps.slice(0, activeStep + 1).map((s, i) => {
                  const isWinner = i === activeStep;
                  const c = LAYER_TOKENS[i % LAYER_TOKENS.length];
                  return (
                    <ResolutionRow
                      key={s.label}
                      style={{ paddingLeft: `${i * 12}px` }}
                    >
                      <ResolutionDot
                        style={{
                          background: isWinner ? c : `color-mix(in srgb, ${c} 30%, transparent)`,
                          boxShadow: isWinner ? `0 0 8px color-mix(in srgb, ${c} 40%, transparent)` : 'none',
                        }}
                      />
                      <ResolutionLabel winner={isWinner} overridden={!isWinner}>
                        {s.label}
                      </ResolutionLabel>
                      <ResolutionStatus winner={isWinner} overridden={!isWinner}>
                        {isWinner ? 'wins' : 'overridden'}
                      </ResolutionStatus>
                    </ResolutionRow>
                  );
                })}
              </ResolutionList>
            </DetailSection>
          </>
        ) : (
          <EmptyDetail>
            <EmptyTitle>Select a cascade layer</EmptyTitle>
            <EmptyHint>Click a step or use <Kbd>↑↓</Kbd> to navigate</EmptyHint>
          </EmptyDetail>
        )}
      </DetailPanel>
    </CascadeGrid>
  );
}
