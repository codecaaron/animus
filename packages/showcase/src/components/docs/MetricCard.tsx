import type { ReactNode } from 'react';

import { ds } from '../../ds';

// ─── Styled Elements ────────────────────────────────────────────

export const MetricGrid = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  })
  .asElement('div');

const CardContainer = ds
  .styles({
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    p: 16,
  })
  .asElement('div');

const MetricValue = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 32,
    fontWeight: 600,
    color: 'text',
    letterSpacing: '-0.03em',
  })
  .asElement('span');

const MetricUnit = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 400,
    color: 'text.dim',
    ml: 2,
  })
  .asElement('span');

const MetricLabel = ds
  .styles({
    fontSize: 12,
    color: 'text.muted',
    mt: 2,
  })
  .asElement('div');

const MetricDelta = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    mt: 8,
    px: 8,
    py: 4,
    display: 'inline-block',
  })
  .variant({
    prop: 'kind',
    defaultVariant: 'neutral',
    variants: {
      good: {
        bg: '{colors.forest.500/10}',
        color: 'forest.500',
      },
      neutral: {
        bg: '{colors.text/4}',
        color: 'text.dim',
      },
    },
  })
  .asElement('span');

// ─── Component ──────────────────────────────────────────────────

export function MetricCard({
  value,
  unit,
  label,
  delta,
  deltaKind = 'neutral',
}: {
  value: string;
  unit?: string;
  label: string;
  delta?: ReactNode;
  deltaKind?: 'good' | 'neutral';
}) {
  return (
    <CardContainer>
      <div>
        <MetricValue>{value}</MetricValue>
        {unit && <MetricUnit>{unit}</MetricUnit>}
      </div>
      <MetricLabel>{label}</MetricLabel>
      {delta && <MetricDelta kind={deltaKind}>{delta}</MetricDelta>}
    </CardContainer>
  );
}
