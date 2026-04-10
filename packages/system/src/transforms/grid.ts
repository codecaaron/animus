import { createTransform } from './createTransform';

/**
 * Self-contained transform: all logic inlined in the callback.
 * No external references — satisfies the extraction constraint.
 */
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

/**
 * Convert a grid item value to a CSS template string.
 * Exported for non-extraction use — NOT referenced from createTransform callbacks.
 */
export const toGridTemplate = (item: string): string => {
  const map: Record<string, string> = {
    max: 'max-content',
    min: 'min-content',
  };
  const template = /^[0-9]*$/.test(item) ? `${item}fr` : (map[item] ?? item);
  return `minmax(0, ${template})`;
};

export const repeatGridItem = (item: string, count: number) => {
  const template = toGridTemplate(item);
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

/**
 * Self-contained transform: all logic inlined in the callback.
 * Duplicates grid-item-to-template logic to avoid cross-transform reference.
 */
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
