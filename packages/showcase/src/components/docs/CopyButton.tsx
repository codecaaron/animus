import { useCallback, useState } from 'react';

import { ds } from '../../ds';

const CopyButtonBase = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'transparent',
    border: 1,
    borderColor: 'border',
    color: 'text.dim',
    cursor: 'pointer',
    fontFamily: 'mono',
    transition: 'all 0.15s ease',
    gap: 4,
    _hover: {
      borderColor: 'border.strong',
      color: 'text.muted',
    },
    _focusVisible: {
      outline: '2px solid {colors.scheme.300}',
      outlineOffset: '2px',
    },
  })
  .variant({
    prop: 'size',
    defaultVariant: 'sm',
    variants: {
      sm: { fontSize: 11, px: 8, py: 2 },
      md: { fontSize: 13, px: 12, py: 4 },
    },
  })
  .states({
    copied: {
      borderColor: '{colors.forest.600}',
      color: '{colors.forest.500}',
    },
  })
  .asElement('button');

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16">
    <path
      d="M3 8.5l3 3 7-7"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16">
    <rect
      x="5"
      y="5"
      width="8"
      height="8"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
    <path
      d="M3 11V3a1.5 1.5 0 011.5-1.5H11"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export function CopyButton({
  text,
  size = 'sm',
}: {
  text: string;
  size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <CopyButtonBase
      type="button"
      size={size}
      copied={copied}
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {size === 'md' && (copied ? 'Copied' : 'Copy')}
    </CopyButtonBase>
  );
}
