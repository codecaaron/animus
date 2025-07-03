import { animus } from '@animus-ui/core';

import { Button, PrimaryButton } from './Button';
import { Card } from './Card';

export const Logo = animus
  .styles({
    width: 'max-content',
    m: 0,
    lineHeight: 'initial',
    fontFamily: 'logo',
    letterSpacing: '2px',
    gradient: 'flowX',
    backgroundSize: '300px 100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    textShadow: 'logo',
    transition: 'text',
  })
  .states({
    link: {
      animation: 'none',
      '&:hover': {
        textShadow: 'logo-hover',
      },
      '&:active': {
        textShadow: 'link-pressed',
      },
    },
  })
  .groups({ typography: true, space: true, color: true })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { xs: 28, sm: 32, md: 64, lg: 72, xl: 96, xxl: 128 },
    },
  })
  .asElement('h1');

function App() {
  return (
    <Card>
      <Logo  color="black" logoSize={{ _: 'md', xs: 'lg', sm: 'xl', lg: 'xxl' }}>
        Animus
      </Logo>
      <Button color="lightpink" bg="red" my={[4, 8]}>
        Click me
      </Button>
      <Button p={{ _: 4, sm: 16 }} size="small">
        Click me
      </Button>
      <Button disabled>Click me</Button>
      <PrimaryButton>Primary Button (extends Button)</PrimaryButton>
    </Card>
  );
}

export default App;
