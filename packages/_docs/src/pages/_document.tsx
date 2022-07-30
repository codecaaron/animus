import createCache from '@emotion/cache';
import createEmotionServer from '@emotion/server/create-instance';
import Document, {
  DocumentContext,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document';
import React from 'react';

class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const originalRenderPage = ctx.renderPage;

    const cache = createCache({ key: 'animus' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { extractCriticalToChunks } = createEmotionServer(cache);

    ctx.renderPage = () =>
      originalRenderPage({
        enhanceApp: (App) => (props) =>
          <App {...({ ...props, cache } as any)} />,
      });

    const initialProps = await Document.getInitialProps(ctx);
    const { styles, html } = extractCriticalToChunks(initialProps.html);
    const emotionStyleTags = styles.map((style) => (
      <style
        data-emotion={`${style.key} ${style.ids.join(' ')}`}
        key={style.key}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: style.css }}
      />
    ));

    return {
      ...initialProps,
      html,
      styles: [
        ...React.Children.toArray(initialProps.styles),
        ...emotionStyleTags,
      ],
    };
  }

  render() {
    return (
      <Html>
        <Head>
          <link
            rel="preload"
            href="https://fonts.gstatic.com/s/majormonodisplay/v10/RWmVoLyb5fEqtsfBX9PDZIGr2tFubRh7DXeRAHRfwg.woff2"
            crossOrigin="anonymous"
            type="font/woff2"
            as="font"
          />
          <link
            rel="preload"
            href="https://fonts.gstatic.com/s/cairo/v17/SLXGc1nY6HkvalIhTpumxdt0.woff2"
            crossOrigin="anonymous"
            type="font/woff2"
            as="font"
          />
          <link rel="dns-prefetch" href="//fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com/"
            crossOrigin="true"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=DM+Mono:ital@0;1&family=Major+Mono+Display&family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
