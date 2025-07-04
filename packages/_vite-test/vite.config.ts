import { animusVitePlugin } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, HtmlTagDescriptor, Plugin } from 'vite';

function injectCssAsStyleTag(): Plugin {
  return {
    name: 'inject-css-as-style-tags',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const htmlTagDescriptors: HtmlTagDescriptor[] = [];
      const bundle = ctx.bundle;
      if (bundle == null) {
        return [];
      }

      Object.values(bundle)
        .filter((output) => output.fileName.endsWith('.css'))
        .forEach((output) => {
          if (output.type === 'asset' && typeof output.source === 'string') {
            htmlTagDescriptors.push({
              tag: 'style',
              children: output.source,
              injectTo: 'head',
            });
          }
        });

      return htmlTagDescriptors;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    animusVitePlugin({
      theme: './src/theme.ts',
      output: 'animus.css',
      atomic: true,
      transform: true,
    }),
    injectCssAsStyleTag(),
  ],
});
