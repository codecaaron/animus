import styled from "@emotion/styled";
import { colors, layout, padding, varia } from "../../shared/props";

const pxRem = (val: number) => `${val / 16}rem`;

export const Grid = styled.div(
  varia.compose(
    layout,
    varia.create({
      columns: {
        property: "gridTemplateColumns",
        scale: "grids",
        transform: (val: string) => `repeat(${val}, minmax(0, 1fr))`,
      },
      gap: {
        property: "gap",
        properties: ["rowGap", "columnGap"],
        scale: "space",
        transform: pxRem,
      },
      gapX: {
        property: "columnGap",
        scale: "space",
        transform: pxRem,
      },
      gapY: {
        property: "rowGap",
        scale: "space",
        transform: pxRem,
      },
    })
  )
);

Grid.defaultProps = { display: "grid", columns: 12 };

export const Column = styled.div(
  varia.compose(
    padding,
    layout,
    colors,
    varia.create({
      rows: {
        property: "gridRow",
        transform: (row: number) => `span ${row}`,
      },
      size: {
        property: "gridColumnEnd",
        scale: "columns",
        transform: (col: number) => `span ${col}`,
      },
      offset: {
        property: "gridColumnStart",
        scale: "columns",
        transform: (col: string) =>
          col === "0" ? "auto" : `${parseInt(col, 10) + 1}`,
      },
    })
  )
);

Column.defaultProps = {
  display: "block",
};
