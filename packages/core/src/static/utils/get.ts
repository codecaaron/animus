/**
 * Simple implementation of lodash's get function for accessing nested object properties
 * @param obj The object to query
 * @param path The path of the property to get (e.g., 'colors.primary' or ['colors', 'primary'])
 * @param defaultValue The value to return if the resolved value is undefined
 */
export function get(
  obj: any,
  path: string | string[],
  defaultValue?: any
): any {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }

  const keys = Array.isArray(path) ? path : path.split('.');

  let result = obj;
  for (const key of keys) {
    if (result == null) {
      return defaultValue;
    }
    result = result[key];
  }

  return result !== undefined ? result : defaultValue;
}
