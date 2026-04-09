import { useState, type ReactNode } from 'react';

import { ds } from '../../ds';

import { TokenBadge } from './TokenBadge';

const CardContainer = ds
  .styles({
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
    transition: 'border-color 0.15s ease',
    _hover: {
      borderColor: 'border.strong',
    },
  })
  .asElement('div');

const CardHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    p: 16,
    bg: 'surface',
    border: 'none',
    cursor: 'pointer',
    gap: 12,
    textAlign: 'left',
    fontFamily: 'body',
  })
  .asElement('button');

const HeaderLeft = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: '1',
    minWidth: '0',
  })
  .asElement('div');

const MethodName = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    color: 'primary',
    fontWeight: 700,
    flexShrink: 0,
  })
  .asElement('span');

const MethodDescription = ds
  .styles({
    color: 'text.dim',
    fontSize: 13,
    fontFamily: 'body',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  })
  .asElement('span');

const HeaderRight = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  })
  .asElement('div');

const Chevron = ds
  .styles({
    fontSize: 12,
    color: 'text.dim',
    fontFamily: 'mono',
    transition: 'transform 0.15s ease',
  })
  .states({
    expanded: { transform: 'rotate(180deg)' },
  })
  .asElement('span');

const DetailSection = ds
  .styles({
    p: 16,
    bg: 'surface',
    borderTop: 1,
    borderTopColor: 'border',
  })
  .asElement('div');

const AvailableAfter = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    mb: 12,
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
  })
  .asElement('div');

export function MethodCard({
  name,
  description,
  returnType,
  available,
  example,
}: {
  name: string;
  description: string;
  returnType: string;
  available?: string;
  example?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const headerId = `method-header-${name.replace(/[^a-z0-9]/gi, '-')}`;
  const detailId = `method-detail-${name.replace(/[^a-z0-9]/gi, '-')}`;

  return (
    <CardContainer>
      <CardHeader
        type="button"
        id={headerId}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        <HeaderLeft>
          <MethodName>.{name}</MethodName>
          <MethodDescription>{description}</MethodDescription>
        </HeaderLeft>
        <HeaderRight>
          <TokenBadge variant="type">{returnType}</TokenBadge>
          <Chevron expanded={expanded}>▼</Chevron>
        </HeaderRight>
      </CardHeader>
      {expanded && (
        <DetailSection id={detailId} role="region" aria-labelledby={headerId}>
          {available && (
            <AvailableAfter>
              available after <TokenBadge variant="method">{available}</TokenBadge>
            </AvailableAfter>
          )}
          {example}
        </DetailSection>
      )}
    </CardContainer>
  );
}
