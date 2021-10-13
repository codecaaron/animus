import { createTheme } from './createTheme/createTheme';
export * from './createTheme/createTheme';

export const test = (cool: string) => {
  console.log(createTheme());
  return `This thing called ${cool}, is really cool`;
};
