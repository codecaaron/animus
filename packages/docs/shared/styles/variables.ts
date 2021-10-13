export const variables = (jsVars: Record<string, string>) => {
  const vars: Record<string, string> = {};
  Object.keys(jsVars).forEach((key) => {
    vars[`--${key}`] = jsVars[key];
  });

  return vars;
};
