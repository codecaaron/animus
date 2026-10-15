/**
 * The packages the session finds foreign to Animus, against the real engine.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { getSharedCss } from '../../session/singleton';
import {
  createAliasedKitApp,
  disposeTempRoots,
  makeSession,
  resetAnimusGlobals,
} from './session-fixtures';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  disposeTempRoots();
});

/** Contract: a package whose tags only an analysed kit's sources import is
 *  judged foreign as one the application's own files import is, and only
 *  where every instance any analysed file loads, by any form of import, is
 *  foreign: a namespace import of an instance that reaches Animus keeps the
 *  name out, and the component it renders keeps its CSS. */
test("a package a kit's sources import is judged foreign", async () => {
  const root = createAliasedKitApp('animus-foreign-packages-');
  const write = (path: string, contents: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  // `icons` has no dependencies, and only the kit imports it.
  write('node_modules/icons/package.json', '{"name":"icons"}');
  // The kit's own `bridge` has none either, but the application's, which it
  // imports as a namespace, reaches Animus and renders R.
  write(
    'node_modules/kit/node_modules/bridge/package.json',
    '{"name":"bridge"}'
  );
  write(
    'node_modules/kit/src/Panel.tsx',
    "import { Icon } from 'icons';\nimport { Icon as Mark } from 'bridge';\nexport const Panel = () => <><Icon /><Mark /></>;\n"
  );
  write(
    'node_modules/bridge/package.json',
    '{"name":"bridge","type":"module","exports":"./index.js","dependencies":{"@animus-ui/system":"*"}}'
  );
  write(
    'node_modules/bridge/index.js',
    "export { R } from '../../src/r.js';\n"
  );
  write(
    'src/r.tsx',
    "import { ds } from './system';\nexport const R = ds.styles({ display: 'flex' }).asElement('div');\n"
  );
  write(
    'src/App.tsx',
    "import * as UI from 'bridge';\nexport const App = () => <UI.R />;\n"
  );
  const session = makeSession(root, { strict: true }, { build: 'b' });
  await session.runFullPipeline();
  expect(session.foreignPackages).toEqual(['icons']);
  expect(getSharedCss(session.key)).toMatch(/display: ?flex/);
}, 60000);
