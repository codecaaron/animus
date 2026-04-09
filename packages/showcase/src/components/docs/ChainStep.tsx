import { ds } from '../../ds';

const ChainContainer = ds
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
    transition: 'all 0.15s ease',
    minWidth: '90px',
    _hover: {
      borderColor: 'border.strong',
    },
  })
  .states({
    active: {
      bg: '{colors.fire.500/12}',
      borderColor: 'primary',
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

const ConnectorArrow = () => (
  <svg width="28" height="12" style={{ flexShrink: 0 }}>
    <line
      x1="2"
      y1="6"
      x2="20"
      y2="6"
      stroke="var(--color-text-dim)"
      strokeWidth="1"
    />
    <polygon points="19,3 25,6 19,9" fill="var(--color-text-dim)" />
  </svg>
);

interface Step {
  label: string;
  layer: string;
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
  return (
    <ChainContainer>
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
          {i < steps.length - 1 && <ConnectorArrow />}
        </StepWrapper>
      ))}
    </ChainContainer>
  );
}
