import { Li, Link, Ol, Text, Ul } from '@animus-ui/components';
import { Code } from 'components/Code';
import { FlowText } from 'components/FlowText';
import { kebabCase } from 'lodash';

import { Highlighter } from '../Highlighter/Highlighter';

export const components = {
  h1: (props) => (
    <FlowText
      shadow="md"
      id={kebabCase(props.children.toString())}
      as="h1"
      fontFamily="mono"
      fontSize={36}
      mb={8}
      {...props}
    />
  ),
  h2: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h2"
      fontFamily="mono"
      fontSize={22}
      mb={16}
      {...props}
    />
  ),
  h3: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h3"
      fontFamily="mono"
      fontSize={18}
      mb={16}
      {...props}
    />
  ),
  h4: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h4"
      fontFamily="mono"
      textTransform="uppercase"
      fontSize={18}
      mb={8}
      {...props}
    />
  ),
  h5: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h5"
      fontFamily="mono"
      fontSize={16}
      mb={16}
      {...props}
    />
  ),
  h6: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h6"
      fontFamily="mono"
      fontSize={14}
      mb={16}
      {...props}
    />
  ),
  p: (props) => <Text as="p" mb={16} {...props} />,
  code: Code,
  li: Li,
  ul: Ul,
  ol: Ol,
  a: (props) => <Link variant="text" {...props} />,
  pre: Highlighter,
};
