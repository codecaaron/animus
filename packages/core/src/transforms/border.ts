import { numberToTemplate } from "./utils";

export const borderShorthand = (val: string | number) => {
  return numberToTemplate(val, (width) => `${width}px solid currentColor`);
};

