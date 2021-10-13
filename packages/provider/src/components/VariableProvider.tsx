import { animus } from '@animus/props';
import styled from '@emotion/styled';

export const VariableProvider = styled('div')(
  animus
    .styles({ color: 'text' })
    .systemProps({
      layout: true,
      color: true,
      grid: true,
      flex: true,
      positioning: true,
      space: true,
      borders: true,
      background: true,
      mode: true,
    })
    .customProps({ hello: { property: 'width' } })
    .build()
);
