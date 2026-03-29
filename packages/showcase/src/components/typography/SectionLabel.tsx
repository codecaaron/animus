import { Label } from './Label';

export const SectionLabel = Label.extend()
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 500,
    color: 'accent',
    pl: 24,
    position: 'relative',
  })
  .system({ text: true, surface: true, space: true })
  .asElement('div');
