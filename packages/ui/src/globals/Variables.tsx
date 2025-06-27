import { css, Global } from '@emotion/react';
import React from 'react';

import { CSSObject } from '@animus-ui/core';

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
