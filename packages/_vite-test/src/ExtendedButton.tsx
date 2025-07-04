import { Button } from './Button';

export const CollisionButton = Button.extend()
  .styles({
    backgroundColor: 'primary',
    fontWeight: 'bold',
  })
  .asElement('button');

export const DangerButton = CollisionButton.extend()
  .styles({
    backgroundColor: 'danger',
  })
  .asElement('button');
