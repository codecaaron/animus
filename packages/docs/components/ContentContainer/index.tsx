import styled from "@emotion/styled";
import { animation, colors, layout, space, varia } from "../../shared/props";

export const ContentContainer = styled.section(
  varia.compose(layout, space, colors, animation)
);

ContentContainer.defaultProps = {
  h: "auto",
  minH: "100%",
  transition: "background-color 200ms ease-in",
};
