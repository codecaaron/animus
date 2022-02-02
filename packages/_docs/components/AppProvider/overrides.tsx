import { useRouter } from 'next/dist/client/router';
import NextLink from 'next/link';

export const overrides = {
  Link: {
    extend:
      (Link) =>
      ({ variant = 'ui', ...props }) => {
        const { asPath } = useRouter();
        return (
          <NextLink href={props.href} passHref>
            <Link
              active={
                props.active !== undefined
                  ? props.active
                  : asPath === props.href
              }
              variant={variant}
              {...props}
            />
          </NextLink>
        );
      },
  },
};
