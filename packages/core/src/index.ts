import { config } from './config';

export * from './AnimusConfig';
export * from './compatTheme';
/** Export extendable config */
export { config } from './config';
export * from './createAnimus';
export * from './scales/createScale';
export * from './transforms';
export * from './types/props';
export * from './types/shared';
export * from './types/theme';
export * from './types/utils';

/** Export full builder */
export const animus = config.build();
