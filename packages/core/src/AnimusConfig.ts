import { Animus } from './Animus';
import { Prop } from './types/config';

export class AnimusConfig<
  C extends Record<string, Prop> = {},
  G extends Record<string, (keyof C)[]> = {},
> {
  #props = {} as C;
  #groups = {} as G;

  constructor(config?: C, groups?: G) {
    this.#props = config || ({} as C);
    this.#groups = groups || ({} as G);
  }

  addGroup<
    Name extends string,
    Conf extends Record<string, Prop>,
    PropNames extends keyof Conf,
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
    const props = this.#props as { [K in keyof C]: C[K] };
    const groups = this.#groups as { [K in keyof G]: G[K] };

    return new Animus(props, groups);
  }
}
