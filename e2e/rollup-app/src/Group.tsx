import { GroupItem } from '@animus-ui/test-ds';

import { Frame } from './Frame';

// Many-place invocation family for the oracle fixture
// (packages/oracle/PLACES.md §4). Four real invocations of the kit
// GroupItem whose ancestor structure differs in exactly the ways the place
// model must distinguish:
//
//   1. established — wrapper carries `data-active="true"` AND `className=
//      "group"`, so the raw-ancestor rule's axis is established and the
//      `.group:hover` axis stays hover-conditional (structure can't refute
//      it);
//   2. refuted — wrapper carries `data-active="false"` and no `group`
//      class, so both ancestor axes are structurally refuted;
//   3. open(opaque) — `<Frame>` hides the structure; every ancestor axis
//      is open with the component boundary as the reason;
//   4. open(dynamic) — `data-active` is a conditional with statically
//      enumerable alternatives, so the place splits rather than resolves.
//
// Deliberately NOT imported by entry.tsx: the standalone CLI's directory
// discovery analyzes this file (fileFacts + usage), while the rollup/
// unplugin host never bundles it — and since a prop-less GroupItem adds no
// CSS, the lane's CLI-vs-host stylesheet parity is untouched.
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
