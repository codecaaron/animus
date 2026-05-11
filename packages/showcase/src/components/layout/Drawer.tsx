import {
  createContext,
  createElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

import { compose } from '@animus-ui/system';

import { ds } from '../../ds';

// ─── Drawer Slot Definitions ──────────────────────────────────────
//
// Composed slide-out panel family. Shared `position` variant controls
// slide direction (left/right) and seam edge placement.

const DrawerOverlay = ds
  .styles({
    position: 'fixed',
    inset: '0',
    zIndex: '200',
    bg: '{colors.bg/85}',
    backdropFilter: 'blur(2px)',
    opacity: '0',
    transition: 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  })
  .states({
    open: { opacity: '1' },
  })
  .asElement('div');

const DrawerPanel = ds
  .styles({
    position: 'fixed',
    top: '0',
    bottom: '0',
    zIndex: '201',
    width: '{sizes.drawerWidth}',
    bg: 'bg.muted',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  })
  .variant({
    prop: 'position',
    defaultVariant: 'left',
    variants: {
      left: {
        left: '0',
        transform: 'translateX(-100%)',
        borderRight: '1px solid transparent',
        borderImage:
          'linear-gradient(180deg, transparent, {colors.primary}, {colors.accent}, {colors.primary}, transparent) 1',
      },
      right: {
        right: '0',
        transform: 'translateX(100%)',
        borderLeft: '1px solid transparent',
        borderImage:
          'linear-gradient(180deg, transparent, {colors.primary}, {colors.accent}, {colors.primary}, transparent) 1',
      },
    },
  })
  .states({
    open: { transform: 'translateX(0)' },
  })
  .asElement('div');

const DrawerHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 16,
    py: 12,
    borderBottom: 1,
    borderColor: 'border',
  })
  .variant({
    prop: 'position',
    defaultVariant: 'left',
    variants: {
      left: {},
      right: {},
    },
  })
  .asElement('div');

const DrawerBody = ds
  .styles({
    flex: '1',
    overflowY: 'auto',
    px: 0,
    py: 8,
  })
  .variant({
    prop: 'position',
    defaultVariant: 'left',
    variants: {
      left: {},
      right: {},
    },
  })
  .asElement('div');

const DrawerRoot = ds
  .styles({})
  .variant({
    prop: 'position',
    defaultVariant: 'left',
    variants: {
      left: {},
      right: {},
    },
  })
  .asElement('div');

export const DrawerSlots = compose(
  {
    Root: DrawerRoot,
    Overlay: DrawerOverlay,
    Panel: DrawerPanel,
    Header: DrawerHeader,
    Body: DrawerBody,
  },
  { shared: { position: true } }
);

// ─── Close Button ─────────────────────────────────────────────────

const CloseButton = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'text.dim',
    cursor: 'pointer',
    border: 'none',
    bg: 'transparent',
    p: 0,
    transition: 'color 0.15s ease',
    '&:hover': { color: 'text' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
      outlineOffset: '2px',
    },
  })
  .asElement('button');

// ─── Focus Trap ───────────────────────────────────────────────────

function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open || !panelRef.current) return;

    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea'
    );

    if (focusable.length > 0) {
      focusable[0].focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const els = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea'
      );
      if (els.length === 0) return;

      const first = els[0];
      const last = els[els.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    const triggerEl = triggerRef.current;
    panel.addEventListener('keydown', handleKeyDown);
    return () => {
      panel.removeEventListener('keydown', handleKeyDown);
      triggerEl?.focus();
    };
  }, [open, panelRef, onClose, triggerRef]);
}

// ─── Drawer Context ───────────────────────────────────────────────

interface DrawerContextValue {
  close: () => void;
}

const DrawerContext = createContext<DrawerContextValue>({ close: () => {} });

// ─── Behavioral Wrapper ──────────────────────────────────────────

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  position?: 'left' | 'right';
  label?: string;
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  position = 'left',
  label,
  triggerRef,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stableClose = useCallback(() => onClose(), [onClose]);

  useFocusTrap(panelRef, open, stableClose, triggerRef);

  if (!open) return null;

  return createPortal(
    createElement(
      DrawerContext.Provider,
      { value: { close: stableClose } },
      createElement(DrawerSlots.Overlay, {
        open: true,
        onClick: stableClose,
        'aria-hidden': 'true',
      }),
      createElement(
        DrawerSlots.Panel,
        {
          ref: panelRef,
          position,
          open: true,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': label ?? 'Drawer',
          style: {
            boxShadow:
              position === 'left'
                ? '4px 0 12px rgba(0,0,0,0.15)'
                : '-4px 0 12px rgba(0,0,0,0.15)',
          },
        },
        createElement(
          DrawerSlots.Header,
          { position },
          createElement(
            CloseButton,
            { onClick: stableClose, 'aria-label': 'Close' },
            position === 'left' ? '← close' : 'close →'
          )
        ),
        createElement(DrawerSlots.Body, { position }, children)
      )
    ),
    document.body
  );
}
