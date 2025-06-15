import { useColorModes } from '@syzygos/components';
import { useContext } from 'react';

import { Button } from '../../elements/Button';
import { ThemeControlContext } from '../ThemeControl';

export const ModeToggle = () => {
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);
  const nextMode = mode === 'light' ? 'dark' : 'light';
  return (
    <Button
      variant={mode === 'dark' ? 'stroke' : 'fill'}
      onClick={() => onChangeMode(nextMode)}
    >
      {mode}
    </Button>
  );
};
