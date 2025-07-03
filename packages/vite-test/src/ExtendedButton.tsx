import { Button } from './Button';

export const PrimaryButton = Button.extend()
  .styles({
    backgroundColor: 'primary',
    fontWeight: 'bold'
  })
  .asElement('button');

export const DangerButton = PrimaryButton.extend()
  .styles({
    backgroundColor: 'danger'
  })
  .asElement('button');
