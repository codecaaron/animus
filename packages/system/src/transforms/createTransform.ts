export type TransformFn = (
  value: string | number,
  property?: string,
  props?: any
) => string | number | Record<string, any>;

export type NamedTransform = TransformFn & { transformName: string };

export function createTransform(name: string, fn: TransformFn): NamedTransform {
  const wrapper: TransformFn = (value, property, props) =>
    fn(value, property, props);
  Object.defineProperty(wrapper, 'name', { value: name });
  return Object.assign(wrapper, { transformName: name }) as NamedTransform;
}
