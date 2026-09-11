import { createTransform } from './createTransform';

/** All logic stays inline: the extractor cannot follow external references. */
export const gridItem = createTransform('gridItem', (item) => {
  const map: Record<string, string> = {
    max: 'max-content',
    min: 'min-content',
  };
  const strItem = String(item);
  const template = /^[0-9]*$/.test(strItem)
    ? `${strItem}fr`
    : (map[strItem] ?? strItem);
  return `minmax(0, ${template})`;
});

/** Template logic is duplicated rather than shared: no external references. */
export const gridItemRatio = createTransform('gridItemRatio', (val) => {
  const toTemplate = (item: string): string => {
    const map: Record<string, string> = {
      max: 'max-content',
      min: 'min-content',
    };
    const template = /^[0-9]*$/.test(item) ? `${item}fr` : (map[item] ?? item);
    return `minmax(0, ${template})`;
  };

  const repeat = (item: string, count: number): string => {
    const template = toTemplate(item);
    return count > 1 ? `repeat(${count}, ${template})` : template;
  };

  if (typeof val === 'number') {
    return repeat('1', val);
  }

  const items = String(val).split(':');
  let repeated: [string, number] = ['', 0];
  let gridStyle = '';

  for (let i = 0; i < items.length + 1; i += 1) {
    const delimiter = gridStyle.length > 0 ? ' ' : '';
    const curr = items[i];
    if (repeated?.[0] !== curr) {
      if (repeated[0].length)
        gridStyle += delimiter + repeat(repeated[0], repeated[1]);
      if (curr) repeated = [curr, 1];
    } else {
      repeated[1] += 1;
    }
  }

  return gridStyle;
});
