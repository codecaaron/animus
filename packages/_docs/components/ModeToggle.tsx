import { animus } from '@animus/props';
import { Theme, useTheme } from '@emotion/react';
import { useContext } from 'react';
import { AppContext } from '../pages/_app';

const Button = animus
  .styles({
    border: 2,
    bg: 'transparent',
    color: 'secondary',
    borderColor: 'currentColor',
  })
  .asComponent('button');

export const ModeToggle = ({}) => {
  const { changeMode } = useContext(AppContext);
  const { mode } = useTheme();
  const nextMode = mode === 'dark' ? 'light' : 'dark';

  return <Button onClick={() => changeMode(nextMode)}>{mode}</Button>;
};
