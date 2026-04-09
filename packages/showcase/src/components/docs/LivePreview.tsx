import { useState, type ReactNode } from 'react';

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
  })
  .asElement('div');

const CodePane = ds
  .styles({
    bg: 'bg',
  })
  .asElement('div');

export function LivePreview({
  preview,
  code,
  defaultTab = 'preview',
}: {
  preview: ReactNode;
  code: ReactNode;
  defaultTab?: 'preview' | 'code';
}) {
  const [tab, setTab] = useState(defaultTab);

  return (
    <PreviewContainer>
      <PreviewHeader>
        <TabGroup
          tabs={['preview', 'code']}
          activeTab={tab}
          onChange={(t) => setTab(t as 'preview' | 'code')}
        />
      </PreviewHeader>
      {tab === 'preview' ? (
        <PreviewPane>{preview}</PreviewPane>
      ) : (
        <CodePane>{code}</CodePane>
      )}
    </PreviewContainer>
  );
}
