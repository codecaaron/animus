import { useColorModes } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { useContext } from 'react';

import { ThemeControlContext } from './AppProvider/ThemeControl';

const Button = animus
  .styles({
    borderRadius: 4,
    boxShadow: 'none',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 'title',
    letterSpacing: '1px',
    px: 8,
    pb: 2,
    minHeight: 28,
    minWidth: 60,
    cursor: 'pointer',
    gradient: 'flowX',
    backgroundSize: '300px 100%',
    // animation: ` ${flow} 5s linear infinite reverse`,
    border: 'none',
    color: 'background',
    transition: 'bg',
    backgroundPosition: '0% 0%',
    '&:hover': {
      backgroundPosition: '-100px 0%',
    },
  })
  .asComponent('button');

export const ModeToggle = () => {
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  return <Button onClick={onChangeMode}>{mode}</Button>;
};
