import { Prop, TransformerMap } from './config';
import { createParser } from './createParser';
import { createTransform } from './createTransform';

export function create<Config extends Record<string, Prop>>(config: Config) {
  // Create a transform function for each of the props
  const transforms = {} as TransformerMap<Config>;
  for (const prop in config) {
    if (typeof prop === 'string') {
      transforms[prop] = createTransform(prop, config[prop]);
    }
  }
  // Create a parser that handles all the props within the config
  return createParser(transforms);
}
