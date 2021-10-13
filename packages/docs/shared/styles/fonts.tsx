import React from "react";
import { css } from "@emotion/react";

export const fontFace = css`
  @font-face {
    font-display: swap;
    font-family: "Apercu";
    font-style: normal;
    font-weight: normal;
    src: url("/fonts/Apercu/apercu-regular-pro.woff2") format("woff2"),
      url("/fonts/Apercu/apercu-regular-pro.woff") format("woff");
  }

  @font-face {
    font-display: swap;
    font-family: "Apercu";
    font-style: normal;
    font-weight: bold;
    src: url("/fonts/Apercu/apercu-bold-pro.woff2") format("woff2"),
      url("/fonts/Apercu/apercu-bold-pro.woff") format("woff");
  }

  @font-face {
    font-display: swap;
    font-family: "Apercu";
    font-style: italic;
    font-weight: normal;
    src: url("/fonts/Apercu/apercu-italic-pro.woff2") format("woff2"),
      url("/fonts/Apercu/apercu-italic-pro.woff") format("woff");
  }

  @font-face {
    font-display: swap;
    font-family: "Apercu";
    font-style: italic;
    font-weight: bold;
    src: url("/fonts/Apercu/apercu-bold-italic-pro.woff2") format("woff2"),
      url("/fonts/Apercu/apercu-bold-italic-pro.woff") format("woff");
  }

  @font-face {
    font-display: swap;
    font-family: "Suisse";
    font-weight: normal;
    src: url("/fonts/Suisse/SuisseIntlMono-Regular-WebS.woff2") format("woff2"),
      url("/fonts/Suisse/SuisseIntlMono-Regular-WebS.woff") format("woff");
  }

  @font-face {
    font-display: swap;
    font-family: "Suisse";
    font-weight: bold;
    src: url("/fonts/Suisse/SuisseIntlMono-Bold-WebS.woff2") format("woff2"),
      url("/fonts/Suisse/SuisseIntlMono-Bold-WebS.woff") format("woff");
  }
`;

export const FontLinks = () => (
  <>
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-bold-italic-pro.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-bold-italic-pro.woff2"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-bold-pro.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-bold-pro.woff2"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-italic-pro.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-italic-pro.woff2"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-regular-pro.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Apercu/apercu-regular-pro.woff2"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Suisse/SuisseIntlMono-Bold-WebS.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Suisse/SuisseIntlMono-Bold-WebS.woff2"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Suisse/SuisseIntlMono-Regular-WebS.woff"
      as="font"
      crossOrigin=""
    />
    <link
      rel="preload"
      href="/fonts/Suisse/SuisseIntlMono-Regular-WebS.woff2"
      as="font"
      crossOrigin=""
    />
  </>
);
