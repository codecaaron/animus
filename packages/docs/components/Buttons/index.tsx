import { css } from "@emotion/react";
import styled from "@emotion/styled";
import { themeCss, variant } from "../../shared/props";
import { Selectors } from "../../shared/styles/selectors";

type ButtonProps = {
  sizeVariant?: "normal" | "small";
  variant?: "primary" | "secondary";
};

const outlineElement = css`
  position: relative;
  &:after {
    content: "";
    position: absolute;
    border: 2px solid transparent;
    border-radius: calc(var(--radius) + 3px);
    padding: 1px;
    inset: -5px;
    transition: border-color 200ms;
  }
`;

const alignmentElement = css`
  &:before {
    content: "";
    height: 100%;
    width: 1px;
    vertical-align: middle;
    display: inline-block;
    margin-left: -1px;
  }
`;

export const TextButton = styled.button<ButtonProps>(
  (props) => {
    return css`
      --radius: 4px;
      line-height: 0;
      font-weight: 700;
      border: 2px solid transparent;
      border-radius: var(--radius);
      transition: background-color 200ms ease-in-out, color 200ms ease-in-out,
        border-color 200ms ease-in-out;
      text-align: center;

      ${alignmentElement}
      ${outlineElement}
  
        ${themeCss({
        font: "base",
        [Selectors.hover]: {
          bg: "emphasizeBackground",
        },
        [Selectors.active]: {
          bg: "muteBackground",
        },
        [Selectors.disabled]: {
          color: "textMuted",
        },
      })(props)}
    `;
  },
  variant({
    primary: {
      color: "primary",
      bg: "background",
      [Selectors.focus]: {
        borderColor: "primary",
        color: "primary",
      },
    },
    secondary: {
      color: "secondary",
      bg: "background",
      [Selectors.focus]: {
        borderColor: "secondary",
        color: "secondary",
      },
    },
  }),
  variant(
    {
      normal: {
        paddingX: ".75rem",
        paddingY: ".5rem",
        fontSize: 16,
        height: "40px",
      },
      small: {
        paddingX: ".5rem",
        paddingY: ".25rem",
        fontSize: 14,
        height: "32px",
      },
    },
    { prop: "sizeVariant" }
  )
);

TextButton.defaultProps = {
  variant: "primary",
  role: "button",
};

export const FillButton = styled(TextButton)(
  variant({
    primary: {
      bg: "primary",
      color: "background",
      [Selectors.hover]: {
        bg: "primaryMuted",
        color: "background",
      },
      [Selectors.active]: {
        bg: "primary",
        borderColor: "primary",
      },
      [Selectors.disabled]: {
        bg: "emphasizeBackground",
      },
    },
    secondary: {
      bg: "secondary",
      color: "background",
      [Selectors.hover]: {
        bg: "secondaryMuted",
        color: "background",
      },
      [Selectors.active]: {
        bg: "secondary",
        borderColor: "secondary",
      },
      [Selectors.disabled]: {
        bg: "emphasizeBackground",
      },
    },
  })
);

export const IconButton = styled(TextButton)(
  variant(
    {
      small: { width: "32px", padding: ".25rem" },
      normal: { width: "40px", padding: ".25rem" },
    },
    { prop: "sizeVariant" }
  )
);

export const StrokeButton = styled(TextButton)(
  variant({
    primary: {
      borderColor: "primary",
      [Selectors.active]: {
        color: "background",
        bg: "primaryMuted",
        borderColor: "primary",
      },
      [Selectors.disabled]: {
        borderColor: "muteBackground",
      },
    },
    secondary: {
      borderColor: "secondary",
      [Selectors.active]: {
        color: "background",
        bg: "secondaryMuted",
        borderColor: "secondary",
      },
      [Selectors.disabled]: {
        borderColor: "muteBackground",
      },
    },
  })
);

StrokeButton.defaultProps = {
  sizeVariant: "normal",
  variant: "primary",
};
