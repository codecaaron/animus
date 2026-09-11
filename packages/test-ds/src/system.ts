import { createSystem } from '@animus-ui/system';
import {
  border,
  color,
  flex,
  layout,
  positioning,
  space,
  typography,
} from '@animus-ui/system/groups';

const kitBundle = createSystem()
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .addGroup('positioning', positioning)
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
    _cardSm: '@container card (min-width: 400px)',
    _hasGrid: '@supports (display: grid)',
  })
  .addSelectors({
    _groupHover: '.group:hover &',
    _dark: '[data-color-mode="dark"] &',
  })
  .build();

export const { createKeyframes } = kitBundle;

export const kitMotion = createKeyframes({
  pulse: {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.6 },
  },
});

export const ds = kitBundle.registerKeyframes({ kitMotion }).seal();
