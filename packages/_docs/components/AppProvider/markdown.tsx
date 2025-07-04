import {
  Box,
  FlexBox,
  GridBox,
  Li,
  Link,
  Ol,
  Text,
  Ul,
} from '@animus-ui/components';
import { MDXProvider } from '@mdx-js/react';
import { Code } from 'elements/Code';
import { FlowText } from 'elements/FlowText';
import { kebabCase } from 'lodash';
import { ComponentProps } from 'react';

import { Highlighter } from '../Highlighter/Highlighter';
import { Meta } from '../Meta';

export const components = {
  h1: (props) => (
    <FlowText
      id={kebabCase(props.children.toString())}
      as="h1"
      fontFamily="heading"
      fontSize={{ _: 26, sm: 34 }}
      mt={{ _: 24, sm: 0 }}
      mb={24}
      fontWeight={600}
      {...props}
    />
  ),
  h2: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h2"
      fontSize={{ _: 22, sm: 26 }}
      mb={16}
      fontWeight={500}
      letterSpacing="1px"
      {...props}
    />
  ),
  h3: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h3"
      fontSize={{ _: 20, sm: 22 }}
      mb={16}
      fontWeight={700}
      {...props}
    />
  ),
  h4: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h4"
      fontSize={{ _: 16, sm: 18 }}
      mb={8}
      fontWeight={700}
      {...props}
    />
  ),
  h5: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h5"
      fontSize={16}
      mb={16}
      fontWeight={700}
      {...props}
    />
  ),
  h6: (props) => (
    <Text
      id={kebabCase(props.children.toString())}
      as="h6"
      fontSize={14}
      mb={16}
      {...props}
    />
  ),
  p: (props) => <Text as="p" mb={16} {...props} />,
  code: Code,
  li: (props) => <Li {...props} />,
  ul: (props) => <Ul {...props} />,
  ol: (props) => <Ol {...props} />,
  a: (props) => <Link variant="text" {...props} />,
  pre: Highlighter,
  Text: (props) => <Text {...props} />,
  Box: (props) => <Box {...props} />,
  FlexBox: (props) => <FlexBox {...props} />,
  GridBox: (props) => <GridBox {...props} />,
  Link: (props) => <Link variant="text" {...props} />,
  Meta,
} satisfies ComponentProps<typeof MDXProvider>['components'];
