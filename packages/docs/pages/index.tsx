import Head from "next/head";
import { Theme } from "@emotion/react";
import { FillButton, StrokeButton, TextButton } from "../components/Buttons";
import { IconButton } from "../components/Buttons/index";
import { Column, Grid } from "../components/Grid";
import { Text } from "../components/Text/index";
import { ContentContainer } from "../components/ContentContainer/index";
import { FontLinks } from "../shared/styles";

export default function Home({ mode }: { mode?: string }) {
  const typographyExample = (
    <>
      {[1, 2, 3, 4, 5, 6].map((size, i) => (
        <Text key={`h${size}`} as={`h${size}` as "h1"}>
          Heading {i + 1}
        </Text>
      ))}
      {([18, 16, 14] as const).map((fontSize) => (
        <Text key={`p-${fontSize}`} as="p" fontSize={fontSize}>
          Lorem ipsum dolor sit amet,{" "}
          <Text as="strong">consectetur adipiscing elit</Text>, sed do eiusmod
          tempor <Text as="em">incididunt ut labore et</Text> dolore magna
          aliqua. Ut enim ad minim veniam
        </Text>
      ))}
    </>
  );

  const buttonExample = (["primary", "secondary"] as const).map((variant) => {
    return ([
      { sizeVariant: "normal" },
      { sizeVariant: "normal", disabled: true },
      { sizeVariant: "small" },
      { sizeVariant: "small", disabled: true },
    ] as const).map((size) => {
      return [FillButton, TextButton, StrokeButton, IconButton].map(
        (ButtonMaybe, i) => {
          return (
            <Column
              key={`${size.sizeVariant}-${
                (size as any).disabled ? "disabled-" : "-"
              }${ButtonMaybe.name}`}
              size={[6, , 3]}
            >
              <ButtonMaybe variant={variant} {...size}>
                {i === 3
                  ? "i"
                  : (size as any).disabled
                  ? "disabled"
                  : size.sizeVariant === "small"
                  ? "small"
                  : variant}
              </ButtonMaybe>
            </Column>
          );
        }
      );
    });
  });

  const gridExample = new Array(25).fill("").map((x, i) => {
    let size: keyof Theme["columns"] = 1;
    if (i === 0) {
      size = 12;
    } else if (i < 3) {
      size = 6;
    } else if (i < 7) {
      size = 3;
    } else if (i < 13) {
      size = 2;
    }
    return (
      <Column key={`col-${x}`} size={size} p={24} bg="emphasizeBackground">
        <Text as="h3" fontSize={22}>
          {size}
        </Text>
      </Column>
    );
  });

  return (
    <>
      <Head>
        <title>Animus</title>
        <link rel="icon" href="/favicon.ico" />
        <FontLinks />
      </Head>
      <ContentContainer w="100%" p={48} pX={[24, , 96]} bg={"background"}>
        <Grid gap={32}>
          <Column size={12} pX={12}>
            <Text as="h1" fontSize={64}>
              {mode} mode
            </Text>
          </Column>
          <Column size={[12, , 6]} pX={12}>
            <Text
              as="h2"
              fontSize={26}
              display="inline-block"
              weight={400}
              textTransform="lowercase"
            >
              <Text fontSize={22} weight={700}>
                1.
              </Text>
              <Text>Typography</Text>
            </Text>
            {typographyExample}
          </Column>
          <Column size={[12, , 6]} pX={12}>
            <Text
              as="h2"
              fontSize={26}
              display="inline-block"
              weight={400}
              textTransform="lowercase"
            >
              <Text fontSize={22} weight={700}>
                2.
              </Text>
              <Text>Buttons</Text>
            </Text>
            <Grid gap={16}>{buttonExample}</Grid>
          </Column>
          <Column size={12} pX={12}>
            <Text
              as="h2"
              fontSize={26}
              display="inline-block"
              weight={400}
              textTransform="lowercase"
            >
              <Text fontSize={22} weight={700}>
                3.
              </Text>
              <Text>Grid</Text>
            </Text>
            <Grid gap={16}>{gridExample}</Grid>
          </Column>
        </Grid>
      </ContentContainer>
    </>
  );
}
