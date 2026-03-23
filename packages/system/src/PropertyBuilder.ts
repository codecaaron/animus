import { Prop } from './types/config';

export class PropertyBuilder<
  PropReg extends Record<string, Prop> = {},
  GroupReg extends Record<string, (keyof PropReg)[]> = {},
> {
  #props: PropReg;
  #groups: GroupReg;

  constructor(props?: PropReg, groups?: GroupReg) {
    this.#props = props || ({} as PropReg);
    this.#groups = groups || ({} as GroupReg);
  }

  addGroup<
    Name extends string,
    Conf extends Record<string, Prop>,
    PropNames extends keyof Conf,
  >(name: Name, config: Conf) {
    const newGroup = {
      [name]: Object.keys(config),
    } as Record<Name, PropNames[]>;

    return new PropertyBuilder(
      { ...this.#props, ...config },
      { ...this.#groups, ...newGroup }
    );
  }

  build() {
    return {
      propRegistry: this.#props as { [K in keyof PropReg]: PropReg[K] },
      groupRegistry: this.#groups as { [K in keyof GroupReg]: GroupReg[K] },
    };
  }
}
