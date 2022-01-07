import { FunctionComponent } from 'react';

export interface ComponentRegistry {
  [x: string]: FunctionComponent<any>;
}

export type ComponentOverrides<Registry extends ComponentRegistry> = {
  [K in keyof Registry]?: {
    wrapper?: FunctionComponent;
    extend?: (component: Registry[K]) => (props: any) => any;
  };
};
