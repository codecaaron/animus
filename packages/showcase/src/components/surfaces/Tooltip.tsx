import { composeWithContext } from '@animus-ui/system/compose-with-context';
import { forwardRef, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ds } from '../../ds';

// ─── Slot Definitions ───────────────────────────────────────────
//
// Minimal tooltip demonstrating context: true for portal-crossing
// shared variant propagation. Content renders via createPortal
// into document.body — CSS descendant selectors can't reach it,
// but React context carries shared variant props through.

const TooltipRoot = ds
  .styles({
    display: 'inline-flex',
    position: 'relative',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: {},
      lg: {},
    },
  })
  .asElement('span');

const TooltipContent = ds
  .styles({
    position: 'fixed',
    fontFamily: 'mono',
    color: 'text',
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    boxShadow: 'glow-accent',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: '1000',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 11 },
      lg: { px: 16, py: 8, fontSize: 14 },
    },
    defaultVariant: 'sm',
  })
  .asElement('div');

// ─── Composed Family ────────────────────────────────────────────
//
// context: true — Content renders through a portal (outside Root's
// DOM subtree), so CSS descendant selectors can't propagate shared
// variants. React context carries the shared `size` prop through
// the portal boundary.

export const TooltipFamily = composeWithContext(
  { Root: TooltipRoot, Content: TooltipContent },
  { shared: { size: true }, name: 'Tooltip' }
);

// ─── Behavioral Wrapper ────────────────────────────────────────
//
// Animus handles styling. This wrapper adds tooltip behavior
// (hover show/hide, positioning, portal rendering). In a real app
// you'd use Radix/Ark — this is a minimal standalone demo.

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  size?: 'sm' | 'lg';
}

export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(
  ({ children, content, size = 'sm' }, ref) => {
    const triggerRef = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
      if (!open || !triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }, [open]);

    return (
      <TooltipFamily.Root
        ref={ref}
        size={size}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <span ref={triggerRef}>{children}</span>
        {open &&
          createPortal(
            <TooltipFamily.Content
              style={{
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, -100%)',
              }}
            >
              {content}
            </TooltipFamily.Content>,
            document.body
          )}
      </TooltipFamily.Root>
    );
  }
);

Tooltip.displayName = 'Tooltip';
