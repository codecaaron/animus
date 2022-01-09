import { Link, Text, Box } from '@animus-ui/components';
import { Highlighter } from '../Highlighter/Highlighter';

export const components = {
  h1: (props) => <Text as="h1" fontSize={36} mb={16} {...props} />,
  h2: (props) => <Text as="h2" fontSize={28} mb={16} {...props} />,
  h3: (props) => <Text as="h3" fontSize={22} mb={16} {...props} />,
  h4: (props) => <Text as="h4" fontSize={18} mb={16} {...props} />,
  h5: (props) => <Text as="h5" fontSize={16} mb={16} {...props} />,
  h6: (props) => <Text as="h6" fontSize={14} mb={16} {...props} />,
  p: (props) => <Text as="p" mb={16} {...props} />,
  inlineCode: (props) => (
    <Box
      as="code"
      color="primary"
      fontWeight={400}
      fontFamily="mono"
      {...props}
    />
  ),
  a: (props) => <Link variant="text" {...props} />,
  pre: Highlighter,
};
