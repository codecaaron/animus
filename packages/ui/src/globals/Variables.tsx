import { css, Global } from '@emotion/react';
import { CSSObject } from '@syzygos/core';
import React from 'react';

const scopeVariables = (vars: CSSObject, scope = ':root') =>
  css({ [scope]: vars });

export const Variables: React.FC<{
  variables: Record<string, CSSObject>;
}> = ({ variables }) => {
  return (
    <>
      {Object.entries(variables).map(([key, vars]) => (
        <Global key={key} styles={scopeVariables(vars)} />
      ))}
    </>
  );
};
