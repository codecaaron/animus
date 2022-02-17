import { useColorModes } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { useContext } from 'react';

import { flow } from '../animations/flow';
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
    gradient: 'flowBg',
    animation: ` ${flow} 5s linear infinite reverse`,
    border: 'none',
    color: 'background',
  })
  .asComponent('button');

export const ModeToggle = () => {
  const [mode] = useColorModes();
  const { onChangeMode } = useContext(ThemeControlContext);

  return <Button onClick={onChangeMode}>{mode}</Button>;
};
