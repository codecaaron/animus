import { ds } from '../../ds';

export const RevealBlock = ds
  .styles({
    opacity: '0',
    transform: 'translateY(24px)',
    transition:
      'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
  })
  .variant({
    prop: 'delay',
    variants: {
      0: {},
      1: { transitionDelay: '0.15s' },
      2: { transitionDelay: '0.3s' },
      3: { transitionDelay: '0.45s' },
      4: { transitionDelay: '0.6s' },
    },
  })
  .states({
    visible: {
      opacity: '1',
      transform: 'translateY(0)',
    },
  })
  .asElement('div');
