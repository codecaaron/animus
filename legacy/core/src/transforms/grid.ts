import { get, isNumber } from 'lodash';

import { createTransform } from './createTransform';

const gridItemMap: Record<string, string> = {
  max: 'max-content',
  min: 'min-content',
};

const unitlessNumber = new RegExp(/^[0-9]*$/);

const isUnitlessNumber = (val: string) => unitlessNumber.test(val);

export const gridItem = createTransform('gridItem', (item) => {
  const strItem = String(item);
  const template = isUnitlessNumber(strItem)
    ? `${strItem}fr`
    : get(gridItemMap, strItem, strItem);
  return `minmax(0, ${template})`;
});

export const repeatGridItem = (item: string, count: number) => {
  const template = (gridItem as Function)(item) as string;
  return count > 1 ? `repeat(${count}, ${template})` : template;
};

export const parseGridRatio = (val: string) => {
  const items = val.split(':');
  let repeated: [string, number] = ['', 0];
  let gridStyle = '';

  for (let i = 0; i < items.length + 1; i += 1) {
    const delimiter = gridStyle.length > 0 ? ' ' : '';
    const curr = items[i];
    if (repeated?.[0] !== curr) {
      if (repeated[0].length)
        gridStyle += delimiter + repeatGridItem(...repeated);
      if (curr) repeated = [curr, 1];
    } else {
      repeated[1] += 1;
    }
  }

  return gridStyle;
};

export const gridItemRatio = createTransform('gridItemRatio', (val) => {
  return isNumber(val)
    ? repeatGridItem('1', val as number)
    : parseGridRatio(val as string);
});
