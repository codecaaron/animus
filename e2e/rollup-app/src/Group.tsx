import { GroupItem } from '@animus-ui/test-ds';

import { Frame } from './Frame';

// Deliberately not imported by entry.tsx: CLI directory discovery analyzes
// it while the host never bundles it, and a prop-less GroupItem adds no CSS.
export const GroupDemo = ({ active }: { active?: boolean }) => (
  <div>
    <div className="group" data-active="true">
      <GroupItem>active kit item</GroupItem>
    </div>
    <div data-active="false">
      <GroupItem>inactive kit item</GroupItem>
    </div>
    <Frame>
      <GroupItem>framed kit item</GroupItem>
    </Frame>
    <div data-active={active ? 'true' : 'false'}>
      <GroupItem>conditional kit item</GroupItem>
    </div>
  </div>
);
