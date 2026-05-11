import { type ReactNode, useState } from 'react';

import { ds } from '../../ds';
import { TabGroup } from './TabGroup';

const PreviewContainer = ds
  .styles({
    border: 1,
    borderColor: 'border',
    overflow: 'hidden',
  })
  .asElement('div');

const PreviewHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    px: 4,
    bg: 'surface',
    borderBottom: 1,
    borderBottomColor: 'border',
  })
  .asElement('div');

const PreviewPane = ds
  .styles({
    p: 24,
    bg: 'bg',
    minHeight: '80px',
    backgroundImage:
      'radial-gradient(circle, {colors.text.dim/15} 0.5px, transparent 0.5px)',
    backgroundSize: '20px 20px',
  })
  .asElement('div');

const CodePane = ds
  .styles({
    bg: 'bg',
    '& > *': {
      border: 'none',
    },
  })
  .asElement('div');

const VariantToolbar = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    py: 6,
    pr: 8,
  })
  .asElement('div');

const VariantGroup = ds
  .styles({
    display: 'flex',
    gap: 2,
    p: 2,
    bg: 'bg',
    border: 1,
    borderColor: 'border',
  })
  .asElement('div');

const VariantOption = ds
  .styles({
    px: 8,
    py: 2,
    fontFamily: 'mono',
    fontSize: 11,
    bg: 'transparent',
    border: 1,
    borderColor: 'transparent',
    color: 'text.dim',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
  })
  .states({
    selected: {
      bg: '{colors.fire.500/12}',
      borderColor: 'primary',
      color: 'primary',
    },
  })
  .asElement('button');

const VariantAxis = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  })
  .asElement('div');

const VariantLabel = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    color: 'text.dim',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  })
  .asElement('span');

export function LivePreview({
  preview,
  code,
  defaultTab = 'preview',
  variants,
}: {
  preview: ReactNode | ((selected: Record<string, string>) => ReactNode);
  code: ReactNode;
  defaultTab?: 'preview' | 'code';
  variants?: Record<string, string[]>;
}) {
  const [tab, setTab] = useState(defaultTab);
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    if (!variants) return {};
    const initial: Record<string, string> = {};
    for (const [key, values] of Object.entries(variants)) {
      initial[key] = values[0];
    }
    return initial;
  });

  const handleVariantChange = (axis: string, value: string) => {
    setSelected((prev) => ({ ...prev, [axis]: value }));
  };

  const renderPreview =
    typeof preview === 'function' ? preview(selected) : preview;

  return (
    <PreviewContainer>
      <PreviewHeader>
        <TabGroup
          tabs={['preview', 'code']}
          activeTab={tab}
          onChange={(t) => setTab(t as 'preview' | 'code')}
        />
        {variants && tab === 'preview' && (
          <VariantToolbar>
            {Object.entries(variants).map(([axis, values]) => (
              <VariantAxis key={axis}>
                <VariantLabel>{axis}</VariantLabel>
                <VariantGroup>
                  {values.map((value) => (
                    <VariantOption
                      key={value}
                      type="button"
                      selected={selected[axis] === value}
                      onClick={() => handleVariantChange(axis, value)}
                    >
                      {value}
                    </VariantOption>
                  ))}
                </VariantGroup>
              </VariantAxis>
            ))}
          </VariantToolbar>
        )}
      </PreviewHeader>
      {tab === 'preview' ? (
        <PreviewPane>{renderPreview}</PreviewPane>
      ) : (
        <CodePane>{code}</CodePane>
      )}
    </PreviewContainer>
  );
}
