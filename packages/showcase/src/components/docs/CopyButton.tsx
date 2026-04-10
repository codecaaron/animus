import { Check, Copy } from 'lucide-react';
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
      borderColor: 'forest.600',
      color: 'forest.500',
    },
  })
  .asElement('button');

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
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {size === 'md' && (copied ? 'Copied' : 'Copy')}
    </CopyButtonBase>
  );
}
