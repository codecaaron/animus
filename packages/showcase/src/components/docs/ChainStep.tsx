import { useCallback, useEffect, useState } from 'react';

import { compose } from '@animus-ui/system';
import { RefreshCwIcon } from 'lucide-react';

import { ds } from '../../ds';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';

// ─── Layout ─────────────────────────────────────────────────────

const CascadeGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
    minHeight: '420px',
    '--color-scheme-50': '{colors.fire.50}',
    '--color-scheme-100': '{colors.fire.100}',
    '--color-scheme-200': '{colors.fire.200}',
    '--color-scheme-300': '{colors.fire.300}',
    '--color-scheme-400': '{colors.fire.400}',
    '--color-scheme-500': '{colors.fire.500}',
    '--color-scheme-600': '{colors.fire.600}',
    '--color-scheme-700': '{colors.fire.700}',
    '--color-scheme-800': '{colors.fire.800}',
    '--color-scheme-900': '{colors.fire.900}',
    '--color-scheme-950': '{colors.fire.950}',
  })
  .asElement('div');

// ─── Strata Column ──────────────────────────────────────────────

const StrataColumn = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    borderRight: 1,
    borderRightColor: 'border',
    bg: 'surface',
  })
  .asElement('nav');

const StrataRowEl = ds
  .styles({
    display: 'flex',
    alignItems: 'stretch',
    cursor: 'pointer',
    borderLeft: 3,
    borderLeftColor: 'transparent',
    transition: 'all 0.2s ease',
    '&:hover': {
      bg: '{colors.text/8}',
    },
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { borderLeftColor: 'text.dim' },
      1: { borderLeftColor: 'scheme.300' },
      2: { borderLeftColor: 'scheme.400' },
      3: { borderLeftColor: 'scheme.500' },
      4: { borderLeftColor: 'scheme.600' },
      5: { borderLeftColor: 'scheme.700' },
    },
  })
  .states({
    active: {
      bg: '{colors.text/6}',
      borderLeftWidth: '4px',
    },
  })
  .asElement('div');

const StrataIndex = ds
  .styles({
    width: '52px',
    py: 24,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  })
  .asElement('div');

const IndexLabelEl = ds
  .styles({
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'mono',
    letterSpacing: '0.06em',
    transition: 'color 0.2s',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { color: 'text.dim' },
      1: { color: 'scheme.300' },
      2: { color: 'scheme.400' },
      3: { color: 'scheme.500' },
      4: { color: 'scheme.600' },
      5: { color: 'scheme.700' },
    },
  })
  .asElement('span');

const SpecDots = ds
  .styles({
    display: 'flex',
    gap: 4,
  })
  .asElement('div');

const DotEl = ds
  .styles({
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    transition: 'background 0.2s',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { bg: '{colors.text.dim/30}' },
      1: { bg: '{colors.scheme.300/30}' },
      2: { bg: '{colors.scheme.400/30}' },
      3: { bg: '{colors.scheme.500/30}' },
      4: { bg: '{colors.scheme.600/30}' },
      5: { bg: '{colors.scheme.700/30}' },
    },
  })
  .asElement('span');

const DotActiveEl = ds
  .styles({
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    transition: 'background 0.2s',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { bg: 'text.dim' },
      1: { bg: 'scheme.300' },
      2: { bg: 'scheme.400' },
      3: { bg: 'scheme.500' },
      4: { bg: 'scheme.600' },
      5: { bg: 'scheme.700' },
    },
  })
  .asElement('span');

const StrataContent = ds
  .styles({
    flex: 1,
    py: 20,
    pr: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
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

const MethodLabelEl = ds
  .styles({
    fontSize: 13,
    fontFamily: 'mono',
    transition: 'color 0.2s',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { color: 'text.dim' },
      1: { color: 'scheme.300' },
      2: { color: 'scheme.400' },
      3: { color: 'scheme.500' },
      4: { color: 'scheme.600' },
      5: { color: 'scheme.700' },
    },
  })
  .states({
    active: {
      fontWeight: 600,
      color: 'text',
    },
  })
  .asElement('code');

const LayerBadgeEl = ds
  .styles({
    fontSize: 10,
    fontFamily: 'mono',
    px: 6,
    py: 1,
    fontWeight: 500,
    letterSpacing: '0.04em',
    flexShrink: 0,
    transition: 'all 0.2s',
    border: 1,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: {
        color: 'text.dim',
        borderColor: 'text.dim',
        bg: '{colors.text.dim/8}',
      },
      1: {
        color: 'scheme.300',
        borderColor: 'scheme.300',
        bg: '{colors.scheme.300/8}',
      },
      2: {
        color: 'scheme.400',
        borderColor: 'scheme.400',
        bg: '{colors.scheme.400/8}',
      },
      3: {
        color: 'scheme.500',
        borderColor: 'scheme.500',
        bg: '{colors.scheme.500/8}',
      },
      4: {
        color: 'scheme.600',
        borderColor: 'scheme.600',
        bg: '{colors.scheme.600/8}',
      },
      5: {
        color: 'scheme.700',
        borderColor: 'scheme.700',
        bg: '{colors.scheme.700/8}',
      },
    },
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
    maxWidth: '100%',
  })
  .asElement('span');

const SpecificityFooter = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 16,
    py: 8,
    fontSize: 11,
    fontFamily: 'mono',
    color: 'text.dim',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    mt: 'auto',
    borderTop: 1,
    borderTopColor: 'border',
    bg: '{colors.text/3}',
  })
  .asElement('div');

// ─── Strata Family (shared layer variant) ───────────────────────

const Strata = compose(
  {
    Root: StrataRowEl,
    IndexLabel: IndexLabelEl,
    Index: StrataIndex,
    Dots: SpecDots,
    Dot: DotEl,
    DotActive: DotActiveEl,
    MethodLabel: MethodLabelEl,
    LayerBadge: LayerBadgeEl,
  },
  { shared: { layer: true } }
);

// ─── Detail Panel ───────────────────────────────────────────────

const DetailPanel = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  })
  .asElement('div');

const DetailContainerEl = ds
  .styles({
    borderLeft: 3,
    bg: 'surface',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { borderLeftColor: 'text.dim' },
      1: { borderLeftColor: 'scheme.300' },
      2: { borderLeftColor: 'scheme.400' },
      3: { borderLeftColor: 'scheme.500' },
      4: { borderLeftColor: 'scheme.600' },
      5: { borderLeftColor: 'primary' },
    },
  })
  .asElement('div');

const DetailHeaderEl = ds
  .styles({
    px: 24,
    pt: 24,
    pb: 20,
    borderBottom: 1,
    borderBottomColor: 'border',
  })
  .asElement('div');

const DetailHeaderTop = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    mb: 16,
    flexWrap: 'wrap',
  })
  .asElement('div');

const DetailMethodNameEl = ds
  .styles({
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'mono',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { color: 'text.dim' },
      1: { color: 'scheme.300' },
      2: { color: 'scheme.400' },
      3: { color: 'scheme.500' },
      4: { color: 'scheme.600' },
      5: { color: 'primary' },
    },
  })
  .asElement('code');

const DetailBadgeEl = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    px: 8,
    py: 2,
    fontWeight: 500,
    letterSpacing: '0.04em',
    border: 1,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: {
        color: 'text.dim',
        borderColor: 'text.dim',
        bg: '{colors.text.dim/8}',
      },
      1: {
        color: 'scheme.300',
        borderColor: 'scheme.300',
        bg: '{colors.scheme.300/8}',
      },
      2: {
        color: 'scheme.400',
        borderColor: 'scheme.400',
        bg: '{colors.scheme.400/8}',
      },
      3: {
        color: 'scheme.500',
        borderColor: 'scheme.500',
        bg: '{colors.scheme.500/8}',
      },
      4: {
        color: 'scheme.600',
        borderColor: 'scheme.600',
        bg: '{colors.scheme.600/8}',
      },
      5: { color: 'primary', borderColor: 'primary', bg: '{colors.primary/8}' },
    },
  })
  .asElement('span');

const RepeatableBadgeEl = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    px: 6,
    py: 1,
    border: 1,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    cursor: 'help',
  })
  .variant({
    prop: 'layer',
    variants: {
      0: {
        color: 'text.dim',
        borderColor: 'text.dim',
        bg: '{colors.text.dim/8}',
      },
      1: {
        color: 'scheme.300',
        borderColor: 'scheme.300',
        bg: '{colors.scheme.300/8}',
      },
      2: {
        color: 'scheme.400',
        borderColor: 'scheme.400',
        bg: '{colors.scheme.400/8}',
      },
      3: {
        color: 'scheme.500',
        borderColor: 'scheme.500',
        bg: '{colors.scheme.500/8}',
      },
      4: {
        color: 'scheme.600',
        borderColor: 'scheme.600',
        bg: '{colors.scheme.600/8}',
      },
      5: { color: 'primary', borderColor: 'primary', bg: '{colors.primary/8}' },
    },
  })
  .states({
    icon: {
      display: 'inline-flex',
      justifyItems: 'center',
      alignContent: 'center',
      border: 'none',
      bg: 'transparent',
    },
  })
  .asElement('span');

const DetailCodeFrameEl = ds
  .styles({
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
    borderTop: 2,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { borderTopColor: 'text.dim' },
      1: { borderTopColor: 'scheme.300' },
      2: { borderTopColor: 'scheme.400' },
      3: { borderTopColor: 'scheme.500' },
      4: { borderTopColor: 'scheme.600' },
      5: { borderTopColor: 'primary' },
    },
  })
  .asElement('div');

// ─── Detail Family (shared layer variant) ───────────────────────

const Detail = compose(
  {
    Root: DetailContainerEl,
    MethodName: DetailMethodNameEl,
    Badge: DetailBadgeEl,
    Repeatable: RepeatableBadgeEl,
    CodeFrame: DetailCodeFrameEl,
  },
  { shared: { layer: true } }
);

// ─── Detail internals ───────────────────────────────────────────

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
    pt: 20,
    pb: 16,
  })
  .asElement('div');

const DetailSectionLabel = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    fontWeight: 400,
    color: '{colors.text.dim/60}',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    mb: 8,
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

const ResolutionDotEl = ds
  .styles({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { bg: 'text.dim', boxShadow: '0 0 6px {colors.text.dim/40}' },
      1: { bg: 'scheme.300', boxShadow: '0 0 6px {colors.scheme.300/40}' },
      2: { bg: 'scheme.400', boxShadow: '0 0 6px {colors.scheme.400/40}' },
      3: { bg: 'scheme.500', boxShadow: '0 0 6px {colors.scheme.500/40}' },
      4: { bg: 'scheme.600', boxShadow: '0 0 6px {colors.scheme.600/40}' },
      5: { bg: 'primary', boxShadow: '0 0 6px {colors.primary/40}' },
    },
  })
  .asElement('span');

const ResolutionDotDimEl = ds
  .styles({
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    flexShrink: 0,
  })
  .variant({
    prop: 'layer',
    variants: {
      0: { bg: '{colors.text.dim/25}' },
      1: { bg: '{colors.scheme.300/25}' },
      2: { bg: '{colors.scheme.400/25}' },
      3: { bg: '{colors.scheme.500/25}' },
      4: { bg: '{colors.scheme.600/25}' },
      5: { bg: '{colors.primary/25}' },
    },
  })
  .asElement('span');

const ResolutionLabel = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
  })
  .states({
    winner: { color: 'text', fontWeight: 700 },
    overridden: {
      color: '{colors.text.dim/50}',
      textDecoration: 'line-through',
    },
  })
  .asElement('code');

const ResolutionStatus = ds
  .styles({
    fontSize: 11,
    fontFamily: 'mono',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginLeft: 'auto',
  })
  .states({
    winner: { color: 'primary', fontWeight: 700 },
    overridden: { color: '{colors.text.dim/40}', fontWeight: 400 },
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
}

type LayerKey = '0' | '1' | '2' | '3' | '4' | '5';

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
          controlledClick(
            Math.min((activeStep < 0 ? -1 : activeStep) + 1, steps.length - 1)
          );
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
  const layerKey = String(activeStep >= 0 ? activeStep : 0) as LayerKey;

  return (
    <CascadeGrid>
      <StrataColumn>
        {steps.map((s, i) => {
          const isActive = i === activeStep;
          const lk = String(i) as LayerKey;
          return (
            <Strata.Root
              key={s.label}
              layer={lk}
              active={isActive}
              onClick={() => handleClick(i)}
            >
              <Strata.Index>
                <Strata.IndexLabel>L{i}</Strata.IndexLabel>
              </Strata.Index>
              <StrataContent>
                <StrataTop>
                  <Strata.MethodLabel active={isActive}>
                    {s.label}
                  </Strata.MethodLabel>
                  <Strata.LayerBadge>@layer {s.layer}</Strata.LayerBadge>
                </StrataTop>
                {s.description && (
                  <InlineDesc>{s.description.split('.')[0]}</InlineDesc>
                )}
                <Strata.Dots>
                  {Array.from({ length: i + 1 }).map((_, j) =>
                    isActive ? (
                      // oxlint-disable-next-line react/no-array-index-key -- composite key with stable step identifier; index is fine
                      <Strata.DotActive key={`${s}-dot-${j as number}`} />
                    ) : (
                      // oxlint-disable-next-line react/no-array-index-key -- composite key with stable step identifier; index is fine
                      <Strata.Dot key={`${s}-dot-${j as number}`} />
                    )
                  )}
                </Strata.Dots>
              </StrataContent>
            </Strata.Root>
          );
        })}
        <SpecificityFooter>
          <span>↑ low</span>
          <span>high ↓</span>
        </SpecificityFooter>
      </StrataColumn>

      <DetailPanel>
        {step ? (
          <Detail.Root layer={layerKey}>
            <DetailHeaderEl>
              <DetailHeaderTop>
                <Detail.MethodName>{step.label}</Detail.MethodName>
                <Detail.Badge>@layer {step.layer}</Detail.Badge>
                {step.repeatable && (
                  <Detail.Repeatable icon asChild>
                    <RefreshCwIcon aria-label="This method can be called multiple times to add additional axes" />
                  </Detail.Repeatable>
                )}
              </DetailHeaderTop>
              {step.description && (
                <DetailDescription>{step.description}</DetailDescription>
              )}
            </DetailHeaderEl>

            {step.code && (
              <DetailSection>
                <DetailSectionLabel>Usage</DetailSectionLabel>
                <Detail.CodeFrame>
                  <SyntaxBlock language="tsx" bordered={false}>
                    {step.code}
                  </SyntaxBlock>
                </Detail.CodeFrame>
              </DetailSection>
            )}

            <DetailSection>
              <DetailSectionLabel>Cascade Resolution</DetailSectionLabel>
              <ResolutionList>
                {steps.slice(0, activeStep + 1).map((s, i) => {
                  const isWinner = i === activeStep;
                  const rlk = String(i) as LayerKey;
                  return (
                    <ResolutionRow
                      key={s.label}
                      style={{ paddingLeft: i * 12 }}
                    >
                      {isWinner ? (
                        <ResolutionDotEl layer={rlk} />
                      ) : (
                        <ResolutionDotDimEl layer={rlk} />
                      )}
                      <ResolutionLabel winner={isWinner} overridden={!isWinner}>
                        {s.label}
                      </ResolutionLabel>
                      <ResolutionStatus
                        winner={isWinner}
                        overridden={!isWinner}
                      >
                        {isWinner ? 'wins' : 'overridden'}
                      </ResolutionStatus>
                    </ResolutionRow>
                  );
                })}
              </ResolutionList>
            </DetailSection>
          </Detail.Root>
        ) : (
          <EmptyDetail>
            <EmptyTitle>Select a cascade layer</EmptyTitle>
            <EmptyHint>
              Click a step or use <Kbd>↑↓</Kbd> to navigate
            </EmptyHint>
          </EmptyDetail>
        )}
      </DetailPanel>
    </CascadeGrid>
  );
}
