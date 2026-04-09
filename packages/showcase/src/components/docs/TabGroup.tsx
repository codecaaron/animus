import { useCallback, useRef } from 'react';

import { ds } from '../../ds';

const TabBar = ds
  .styles({
    display: 'flex',
    gap: 0,
    borderBottom: 1,
    borderBottomColor: 'border',
  })
  .asElement('div');

const TabButton = ds
  .styles({
    px: 20,
    py: 10,
    bg: 'transparent',
    border: 'none',
    borderBottom: 2,
    borderBottomColor: 'transparent',
    color: 'text.dim',
    fontFamily: 'mono',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    mb: -1,
    _hover: {
      color: 'text.muted',
    },
    _focusVisible: {
      outline: '2px solid {colors.scheme.300}',
      outlineOffset: '-2px',
    },
  })
  .states({
    active: {
      borderBottomColor: 'primary',
      color: 'text',
    },
  })
  .asElement('button');

export function TabGroup({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
}) {
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = tabs.indexOf(activeTab);
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = (currentIndex + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      onChange(tabs[nextIndex]);

      const buttons = tabListRef.current?.querySelectorAll('[role="tab"]');
      (buttons?.[nextIndex] as HTMLElement)?.focus();
    },
    [tabs, activeTab, onChange]
  );

  return (
    <TabBar role="tablist" ref={tabListRef} onKeyDown={handleKeyDown}>
      {tabs.map((tab) => (
        <TabButton
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          active={activeTab === tab}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => onChange(tab)}
        >
          {tab}
        </TabButton>
      ))}
    </TabBar>
  );
}
