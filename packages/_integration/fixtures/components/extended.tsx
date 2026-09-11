import { Button } from './button';

export const OutlineButton = Button.extend()
  .styles({
    border: '1px solid',
    borderColor: 'primary',
    bg: 'transparent',
  })
  .asElement('button');

export const App = () => <OutlineButton size="small" intent="primary" />;
