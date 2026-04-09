import type { ReactNode } from 'react';

import { Accordion } from '@ark-ui/react/accordion';
import { ChevronDown } from 'lucide-react';

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
    gap: 8,
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

const ChevronIcon = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'text.dim',
    transition: 'transform 0.15s ease',
    '&[data-state="open"]': {
      transform: 'rotate(180deg)',
    },
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
  return (
    <Accordion.Root collapsible>
      <CardContainer asChild>
        <Accordion.Item value={name}>
          <CardHeader asChild>
            <Accordion.ItemTrigger>
              <HeaderLeft>
                <MethodName>.{name}</MethodName>
                <MethodDescription>{description}</MethodDescription>
              </HeaderLeft>
              <HeaderRight>
                <TokenBadge variant="type">{returnType}</TokenBadge>
                <ChevronIcon asChild>
                  <Accordion.ItemIndicator>
                    <ChevronDown size={14} />
                  </Accordion.ItemIndicator>
                </ChevronIcon>
              </HeaderRight>
            </Accordion.ItemTrigger>
          </CardHeader>
          <DetailSection asChild>
            <Accordion.ItemContent>
              {available && (
                <AvailableAfter>
                  available after{' '}
                  <TokenBadge variant="method">{available}</TokenBadge>
                </AvailableAfter>
              )}
              {example}
            </Accordion.ItemContent>
          </DetailSection>
        </Accordion.Item>
      </CardContainer>
    </Accordion.Root>
  );
}
