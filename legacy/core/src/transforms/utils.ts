export const numberToTemplate = (
  val: string | number,
  template: (val: number) => string
) => (typeof val === 'number' ? template(val) : val);

export const numberToPx = (val: string | number) => {
  return numberToTemplate(val, (pixels) => `${pixels}px`);
};
