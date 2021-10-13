import { css, Global, Theme, ThemeProvider, useTheme } from "@emotion/react";
import { theme } from "../shared/theme";
import styled from "@emotion/styled";
import { useState, useMemo } from "react";
import { StrokeButton } from "../components/Buttons";
import { fontFace, variables } from "../shared/styles";
import { reset } from "../shared/styles/reset";
import { themeCss } from "../shared/props";

const Switch = styled.div(
  themeCss({
    position: "fixed",
    top: "1rem",
    right: "1rem",
    width: "65px",
    display: "grid",
  })
);

const VarianceGlobal = () => {
  const {
    colorModes: { activeMode, modes },
  } = useTheme();
  const modeVars = modes[activeMode];
  const globalStyles = useMemo(
    () => css`
      body {
        ${css(variables(modeVars))}
      }
    `,
    [modeVars]
  );

  return <Global styles={globalStyles} />;
};

const StaticGlobal = () => (
  <Global
    styles={css`
      ${fontFace}
      ${reset}
    `}
  />
);

const App = ({ Component, pageProps }: any) => {
  const allModes = Object.keys(
    theme.colorModes.modes
  ) as (keyof Theme["colorModes"]["modes"])[];

  const [mode, setMode] = useState(0);
  const modeTheme = {
    ...theme,
    colorModes: {
      ...theme.colorModes,
      activeMode: allModes[mode],
    },
  };

  return (
    <ThemeProvider theme={modeTheme}>
      <StaticGlobal />
      <VarianceGlobal />
      <Component {...pageProps} />
      <Switch>
        <StrokeButton
          sizeVariant="small"
          onClick={() => {
            const nextMode = mode + 1 >= allModes.length ? 0 : mode + 1;
            setMode(nextMode);
          }}
        >
          {allModes[mode]}
        </StrokeButton>
      </Switch>
    </ThemeProvider>
  );
};

export default App;
