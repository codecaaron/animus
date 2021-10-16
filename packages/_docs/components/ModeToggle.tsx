import { animus } from '@animus/props';
import { useTheme } from '@emotion/react';
import { useContext } from 'react';
import { AppContext } from '../pages/_app';

const Button = animus
  .styles({
    border: 2,
    bg: 'background-current',
    color: 'secondary',
    borderColor: 'currentColor',
    borderRadius: '4px',
    '&:hover': {
      cursor: 'pointer',
      backgroundColor: 'rgba(0, 0, 0, 0.1)',
    },
  })
  .asComponent('button');

export const ModeToggle = ({}) => {
  const { changeMode } = useContext(AppContext);
  const { mode } = useTheme();
  const nextMode = mode === 'dark' ? 'light' : 'dark';

  return <Button onClick={() => changeMode(nextMode)}>{mode}</Button>;
};
