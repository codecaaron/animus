import { useColorModes } from '@animus-ui/components';
import { useContext } from 'react';

import { Button } from '../../elements/Button';
import { ThemeControlContext } from '../ThemeControl';

export const ModeToggle = () => {
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  return (
    <Button
      onClick={onChangeMode}
      variant={mode === 'dark' ? 'stroke' : 'fill'}
    >
      {mode}
    </Button>
  );
};
