import { createScale } from '@animus/core';
import { animus } from '@animus/props';
import { transformGridItem, transformGridItemRatio } from './props';

export const GridBox = animus
  .styles({ display: 'grid' })
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
    center: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    row: {
      gridAutoFlow: 'row',
    },
    column: {
      gridAutoFlow: 'column',
    },
  })
  .systemProps({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    grid: true,
  })
  .customProps({
    flow: {
      property: 'gridAutoFlow',
      scale: {
        row: 'row',
        column: 'column',
        dense: 'dense',
        'column-dense': 'column dense',
        'row-dense': 'row dense',
      },
    },
    cols: {
      property: 'gridTemplateColumns',
      transform: transformGridItemRatio,
      scale: createScale<string | number>(),
    },
    rows: {
      property: 'gridTemplateRows',
      transform: transformGridItemRatio,
      scale: createScale<string | number>(),
    },
    autoRows: {
      property: 'gridAutoRows',
      transform: transformGridItem,
    },
    autoCols: {
      property: 'gridAutoColumns',
      transform: transformGridItem,
    },
    alignAll: {
      property: 'justifyContent',
      properties: ['justifyContent', 'alignItems'],
    },
  })
  .asComponent('div');
