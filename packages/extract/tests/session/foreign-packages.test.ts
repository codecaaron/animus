/**
 * The packages the session finds foreign to Animus, against the real engine.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  createAliasedKitApp,
  disposeTempRoots,
  resetAnimusGlobals,
  startSession,
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
 *  judged foreign as one the application's own files import is. */
test("a package a kit's sources import is judged foreign", async () => {
  const root = createAliasedKitApp('animus-foreign-packages-');
  const write = (path: string, contents: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };
  // `icons` has no dependencies, and only the kit imports it.
  write('node_modules/icons/package.json', '{"name":"icons"}');
  write(
    'node_modules/kit/src/Panel.tsx',
    "import { Icon } from 'icons';\nexport const Panel = () => <Icon />;\n"
  );
  const session = await startSession(root);
  expect(session.foreignPackages).toEqual(['icons']);
}, 60000);
