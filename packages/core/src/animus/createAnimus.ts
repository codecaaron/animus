import { PropConfig } from '../types/config';
import { Animus } from './animus';

export class AnimusConfig<
  C extends PropConfig['props'] = {},
  G extends Record<string, (keyof C)[]> = {}
> {
  #props = {} as C;
  #groups = {} as G;

  constructor(config?: C, names?: G) {
    this.#props = config || ({} as C);
    this.#groups = names || ({} as G);
  }

  addGroup<
    Name extends string,
    Conf extends PropConfig['props'],
    PropNames extends keyof Conf
  >(name: Name, config: Conf) {
    const newGroup = {
      [name]: Object.keys(config),
    } as Record<Name, PropNames[]>;

    return new AnimusConfig(
      { ...this.#props, ...config },
      { ...this.#groups, ...newGroup }
    );
  }

  build() {
    return new Animus({
      props: this.#props as { [K in keyof C]: C[K] },
      groups: this.#groups as { [K in keyof G]: G[K] },
    });
  }
}

export const createAnimus = () => new AnimusConfig();
