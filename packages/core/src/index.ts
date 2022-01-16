export * from './types/props';
export * from './types/theme';
export * from './types/utils';

export * from './scales/createScale';
export * from './AnimusConfig';
export * from './createAnimus';
export * from './transforms';
export * from './legacy/core';

export { config } from './config';
import { config } from './config';

export const animus = config.build();
