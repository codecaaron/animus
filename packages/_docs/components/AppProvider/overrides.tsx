import { useRouter } from 'next/dist/client/router';

import NextLink from 'next/link';

export const overrides = {
  Link: {
    extend: (Link) => (props) => {
      const { asPath } = useRouter();
      return (
        <NextLink href={props.href} passHref>
          <Link active={asPath === props.href} {...props} />
        </NextLink>
      );
    },
  },
};
