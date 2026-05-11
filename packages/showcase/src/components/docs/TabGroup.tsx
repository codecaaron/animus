import { Tabs } from '@ark-ui/react/tabs';

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
    py: 8,
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
    _selected: {
      borderBottomColor: 'primary',
      color: 'text',
    },
  })
  .asElement('button');

export function TabGroup({
  tabs,
  activeTab,
  onChange,
  children,
}: {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(details) => onChange(details.value)}
    >
      <TabBar asChild>
        <Tabs.List>
          {tabs.map((tab) => (
            <TabButton key={tab} asChild>
              <Tabs.Trigger value={tab}>{tab}</Tabs.Trigger>
            </TabButton>
          ))}
        </Tabs.List>
      </TabBar>
      {children}
    </Tabs.Root>
  );
}
