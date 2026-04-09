import { ds } from '../../ds';

// ─── Styled Elements ────────────────────────────────────────────

const BundleGroup = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  })
  .asElement('div');

const BundleRow = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  })
  .asElement('div');

const BundleLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
    minWidth: '80px',
    textAlign: 'right',
    flexShrink: 0,
  })
  .asElement('span');

const BundleTrack = ds
  .styles({
    flex: 1,
    height: '26px',
    bg: '{colors.text/4}',
    overflow: 'hidden',
  })
  .asElement('div');

const BundleFill = ds
  .styles({
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    px: 8,
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    color: 'text',
    transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
  })
  .variant({
    prop: 'category',
    variants: {
      runtime: { bg: 'primary' },
      extracted: { bg: 'forest.500' },
      static: { bg: 'ocean.500' },
    },
  })
  .asElement('div');

// ─── Component ──────────────────────────────────────────────────

interface BundleItem {
  label: string;
  value: string;
  percent: number;
  category: 'runtime' | 'extracted' | 'static';
}

export function BundleBar({ items }: { items: BundleItem[] }) {
  return (
    <BundleGroup>
      {items.map((item) => (
        <BundleRow key={item.label}>
          <BundleLabel>{item.label}</BundleLabel>
          <BundleTrack>
            <BundleFill
              category={item.category}
              style={{ width: `${item.percent}%` }}
            >
              {item.value}
            </BundleFill>
          </BundleTrack>
        </BundleRow>
      ))}
    </BundleGroup>
  );
}
