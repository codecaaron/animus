import { Animus } from './animusBuilder2';

const Testy = new Animus({
  props: { cool: { property: 'margin', scale: { 2: 2, 4: 4 } } },
  groups: {
    margin: ['cool'],
  },
})
  .styles({
    cool: 2,
    marginTop: '',
  })
  .variant({
    prop: 'vilee',
    variants: {
      doit: { cool: 2 },
    },
  })
  .states({ poop: { cool: 4 } })
  .systemProps({ margin: true })
  .customProps({ zoom: { property: 'padding', scale: { cool: 'beans' } } })
  .asComponent('div');

const boom = Testy({ zoom: { _: 1 }, poop: true, vilee: 'doit' });
