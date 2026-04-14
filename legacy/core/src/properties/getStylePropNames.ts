import { keys, pick } from 'lodash';

export const getStylePropNames = (
  props: Record<string, any>,
  filteredKeys: string[]
) =>
  pick(
    props,
    keys(props).filter((key) => !filteredKeys.includes(key))
  );
