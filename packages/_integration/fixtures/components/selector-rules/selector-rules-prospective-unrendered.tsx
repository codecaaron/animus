import { ds } from '../../setup';

// Pattern H — ds-built component that is defined but never rendered.
// In production (dev_mode=false) the reconciler eliminates it as
// "component not rendered and not a parent".
// In dev mode (dev_mode=true) Position 3 dictates the component stays in
// the manifest (HMR ergonomics) but `report.eliminated_details` carries a
// prospective entry with kind="prospective_component" so the vite/next
// plugin can emit a warning at authoring time.
export const PatternH = ds
  .styles({
    color: 'text',
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
    },
  })
  .asElement('div');
