import { ds } from '../../ds';
import { SyntaxBlock } from '../surfaces/SyntaxBlock';

// ─── Styled Elements ────────────────────────────────────────────

const BAContainer = ds
  .styles({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
  })
  .asElement('div');

const BAPane = ds
  .styles({
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
  })
  .states({
    right: {
      borderLeft: 1,
      borderLeftColor: 'border',
    },
  })
  .asElement('div');

const BAPaneHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 16,
    py: 8,
    bg: 'surface',
    borderBottom: 1,
    borderBottomColor: 'border',
  })
  .asElement('div');

const BAPaneLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
  })
  .variant({
    prop: 'kind',
    variants: {
      input: { color: 'text.muted' },
      output: { color: 'forest.500' },
    },
  })
  .asElement('span');

const BATag = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    px: 8,
    py: 2,
  })
  .variant({
    prop: 'kind',
    variants: {
      runtime: {
        border: 1,
        borderColor: 'border',
        color: 'text.dim',
      },
      extracted: {
        border: 1,
        borderColor: 'forest.700',
        color: 'forest.500',
      },
    },
  })
  .asElement('span');

// ─── Component ──────────────────────────────────────────────────

type Language = 'tsx' | 'css' | 'jsx' | 'typescript' | 'sh';

interface Pane {
  label: string;
  code: string;
  language?: Language;
}

export function BeforeAfter({
  before,
  after,
}: {
  before: Pane;
  after: Pane;
}) {
  return (
    <BAContainer>
      <BAPane>
        <BAPaneHeader>
          <BAPaneLabel kind="input">{before.label}</BAPaneLabel>
          <BATag kind="runtime">runtime</BATag>
        </BAPaneHeader>
        <SyntaxBlock language={before.language ?? 'tsx'} bordered={false}>
          {before.code}
        </SyntaxBlock>
      </BAPane>
      <BAPane right>
        <BAPaneHeader>
          <BAPaneLabel kind="output">{after.label}</BAPaneLabel>
          <BATag kind="extracted">extracted</BATag>
        </BAPaneHeader>
        <SyntaxBlock language={after.language ?? 'css'} bordered={false}>
          {after.code}
        </SyntaxBlock>
      </BAPane>
    </BAContainer>
  );
}
