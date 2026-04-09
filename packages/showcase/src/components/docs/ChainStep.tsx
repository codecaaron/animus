import { ArrowRight } from 'lucide-react';

import { ds } from '../../ds';
import { TokenBadge } from './TokenBadge';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';

const ChainContainer = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  })
  .asElement('div');

const ChainStrip = ds
  .styles({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 0,
  })
  .asElement('div');

const StepButton = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    px: 16,
    py: 10,
    bg: 'transparent',
    border: 1,
    borderColor: 'border',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minWidth: '90px',
    _hover: {
      borderColor: 'border.strong',
    },
  })
  .states({
    active: {
      bg: '{colors.fire.500/12}',
      borderColor: 'primary',
      boxShadow: '0 0 20px {colors.fire.500/12}',
    },
  })
  .asElement('button');

const StepLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    fontWeight: 500,
    color: 'text',
  })
  .states({
    active: { color: 'primary' },
  })
  .asElement('span');

const LayerLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  })
  .states({
    active: { color: '{colors.fire.700}' },
  })
  .asElement('span');

const StepWrapper = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 0,
  })
  .asElement('div');

const ConnectorArrowWrapper = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    color: 'text.dim',
    flexShrink: 0,
    px: 4,
  })
  .asElement('span');

const DetailPanel = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
    mt: 0,
    border: 1,
    borderColor: 'border',
    borderTop: 'none',
    overflow: 'hidden',
  })
  .asElement('div');

const DetailInfo = ds
  .styles({
    p: 20,
    borderRight: 1,
    borderRightColor: 'border',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  })
  .asElement('div');

const DetailDescription = ds
  .styles({
    fontFamily: 'body',
    fontSize: 14,
    color: 'text.muted',
    lineHeight: 'relaxed',
    m: 0,
  })
  .asElement('p');

const InfoBar = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  })
  .asElement('div');

const MetaBadge = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 10,
    px: 8,
    py: 2,
  })
  .variant({
    prop: 'kind',
    variants: {
      repeatable: {
        bg: '{colors.gold.300/10}',
        border: 1,
        borderColor: '{colors.gold.700}',
        color: '{colors.gold.300}',
      },
      once: {
        bg: 'surface',
        border: 1,
        borderColor: 'border',
        color: 'text.dim',
      },
    },
  })
  .asElement('span');

const CascadeBarContainer = ds
  .styles({
    display: 'flex',
    gap: 3,
    alignItems: 'flex-end',
    mt: 4,
  })
  .asElement('div');

const CascadeBarSegment = ds
  .styles({
    width: '28px',
    transition: 'all 0.2s ease',
  })
  .states({
    active: { bg: 'primary' },
    past: { bg: '{colors.fire.500/30}' },
    future: { bg: '{colors.gray.600}' },
  })
  .asElement('div');

const CascadeLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 9,
    color: 'text.dim',
    ml: 8,
    alignSelf: 'center',
  })
  .asElement('span');

const DetailCode = ds
  .styles({
    p: 0,
    overflow: 'hidden',
  })
  .asElement('div');

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
  activeStep,
  onStepClick,
}: {
  steps: Step[];
  activeStep: number;
  onStepClick: (index: number) => void;
}) {
  const active = steps[activeStep];
  const hasDetail = active?.description || active?.code;

  return (
    <ChainContainer>
      <ChainStrip>
        {steps.map((step, i) => (
          <StepWrapper key={step.label}>
            <StepButton
              type="button"
              active={i === activeStep}
              onClick={() => onStepClick(i)}
            >
              <StepLabel active={i === activeStep}>{step.label}</StepLabel>
              <LayerLabel active={i === activeStep}>{step.layer}</LayerLabel>
            </StepButton>
            {i < steps.length - 1 && (
              <ConnectorArrowWrapper>
                <ArrowRight size={16} />
              </ConnectorArrowWrapper>
            )}
          </StepWrapper>
        ))}
      </ChainStrip>
      {hasDetail && (
        <DetailPanel>
          <DetailInfo>
            <InfoBar>
              <TokenBadge variant="method">{active.label}</TokenBadge>
              <span
                style={{
                  color: 'var(--color-text-dim)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
              >
                &rarr;
              </span>
              <TokenBadge variant="layer">@layer {active.layer}</TokenBadge>
              {active.repeatable !== undefined && (
                <MetaBadge kind={active.repeatable ? 'repeatable' : 'once'}>
                  {active.repeatable ? 'repeatable' : 'once'}
                </MetaBadge>
              )}
            </InfoBar>
            <DetailDescription>{active.description}</DetailDescription>
            <CascadeBarContainer>
              {steps.map((_, i) => (
                <CascadeBarSegment
                  key={i}
                  active={i === activeStep}
                  past={i < activeStep}
                  future={i > activeStep}
                  style={{ height: 4 + (i + 1) * 4 }}
                />
              ))}
              <CascadeLabel>cascade specificity</CascadeLabel>
            </CascadeBarContainer>
          </DetailInfo>
          <DetailCode>
            {active.code && (
              <SyntaxBlock language="tsx" showLineNumbers>
                {active.code}
              </SyntaxBlock>
            )}
          </DetailCode>
        </DetailPanel>
      )}
    </ChainContainer>
  );
}
