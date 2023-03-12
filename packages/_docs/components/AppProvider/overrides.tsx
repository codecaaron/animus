import NextLink from 'next/link';

export const overrides = {
  Link: {
    extend: (Link) => {
      return Link.extend().states({ active: {} }).asComponent(NextLink);
    },
  },
};
