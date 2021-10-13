import { css } from "@emotion/react";
import { Selectors } from "./selectors";

export const reset = css`
  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    font-size: 16px;
    font-family: "Apercu", Arial, Helvetica, sans-serif;
    height: 100%;
    width: 100%;
    > * {
      height: 100%;
    }
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    line-height: 1.1;
    font-family: "Suisse", Arial, Helvetica, sans-serif;
    font-weight: bold;
  }

  button {
    box-shadow: none;
    outline: none;
    border: none;
    cursor: pointer;

    ${Selectors.disabled} {
      cursor: not-allowed;
    }
  }
`;
