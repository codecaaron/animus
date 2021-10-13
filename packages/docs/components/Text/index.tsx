import styled from "@emotion/styled";
import {
  colors,
  layout,
  themeCss,
  typography,
  varia,
  variant,
} from "../../shared/props";

const headings = {
  fontWeight: "bold",
  lineHeight: 1.1,
  marginBottom: "calc(.75rem + .75rem)",
  marginTop: "calc(.75rem + .25rem)",
  font: "accent",
  "&:first-of-type": {
    marginTop: "0",
  },
} as const;

const text = {
  lineHeight: 1.5,
  font: "base",
  fontWeight: "normal",
} as const;

const BaseText = styled.span(
  (props) =>
    themeCss({
      color: "text",
      fontSize: "inherit" as any,
      fontFamily: "inherit",
    })(props),
  variant(
    {
      h1: {
        fontSize: 48,
        ...headings,
      },
      h2: {
        fontSize: 32,
        ...headings,
      },
      h3: {
        fontSize: 26,
        ...headings,
      },
      h4: {
        fontSize: 22,
        ...headings,
      },
      h5: {
        fontSize: 18,
        ...headings,
      },
      h6: {
        fontSize: 16,
        ...headings,
      },
      p: {
        fontSize: 18,
        ...text,
      },
      span: {
        display: "inline-block",
      },
      strong: {
        fontWeight: 700,
      },
      em: {
        textDecoration: "italic",
      },
    },
    { prop: "as" }
  )
);

export const Text = styled(BaseText)(varia.compose(typography, colors, layout));
