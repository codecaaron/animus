import { Link, Text, Box } from '@animus-ui/components';
import { kebabCase } from 'lodash';
import { Highlighter } from '../Highlighter/Highlighter';

export const components = {
  h1: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h1"
      fontFamily="monospace"
      fontSize={36}
      mb={8}
      {...props}
    />
  ),
  h2: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h2"
      fontFamily="monospace"
      fontSize={28}
      mb={16}
      {...props}
    />
  ),
  h3: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h3"
      fontFamily="monospace"
      fontSize={22}
      mb={16}
      {...props}
    />
  ),
  h4: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h4"
      fontFamily="monospace"
      fontSize={18}
      mb={16}
      {...props}
    />
  ),
  h5: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h5"
      fontFamily="monospace"
      fontSize={16}
      mb={16}
      {...props}
    />
  ),
  h6: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h6"
      fontFamily="monospace"
      fontSize={14}
      mb={16}
      {...props}
    />
  ),
  p: (props) => (
    <Text as="p" lineHeight="body" fontSize={14} mb={16} {...props} />
  ),
  inlineCode: (props) => (
    <Box
      as="code"
      color="primary"
      fontWeight={400}
      fontFamily="mono"
      {...props}
    />
  ),
  li: (props) => <Box as="li" lineHeight="body" fontSize={14} {...props} />,
  a: (props) => <Link variant="text" {...props} />,
  pre: Highlighter,
};
