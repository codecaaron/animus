import { ds } from '../../ds';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';

const Container = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    my: 24,
  })
  .variant({
    prop: 'layout',
    variants: {
      stacked: {},
      split: {},
    },
  })
  .system({ space: true, surface: true })
  .asElement('div');

const PanelLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'text-muted',
    px: 20,
    py: 8,
    bg: 'code',
    borderBottom: 1,
    borderColor: 'code-border',
  })
  .asElement('div');

const Panel = ds
  .styles({
    flex: '1',
    minWidth: '0',
  })
  .asElement('div');

export function CodeExample({
  input,
  output,
  inputLabel = 'surface',
  outputLabel = 'substrate',
  layout = 'stacked',
}: {
  input: string;
  output: string;
  inputLabel?: string;
  outputLabel?: string;
  layout?: 'stacked' | 'split';
}) {
  return (
    <Container layout={layout}>
      <Panel>
        <PanelLabel>{inputLabel}</PanelLabel>
        <SyntaxBlock language="tsx">{input}</SyntaxBlock>
      </Panel>
      <Panel>
        <PanelLabel>{outputLabel}</PanelLabel>
        <SyntaxBlock language="css">{output}</SyntaxBlock>
      </Panel>
    </Container>
  );
}
