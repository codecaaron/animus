/**
 * SourceId derivation authority + allowlist membership (openspec:
 * external-source-watch-ingestion, design D1/D2/D5).
 *
 * Containment and volume helpers are pure and path-API-injectable, so the
 * Windows cases run via `path.win32` on any host (no Windows CI needed);
 * the identity handle's runtime behavior (canonicalization, alias
 * recording, symlink-escape rejection, cached-identity deletion) runs
 * against real temp trees.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, win32 } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createSourceIdentity,
  isPathWithinRoot,
  sharesVolumeRoot,
} from '../pipeline/source-identity';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTree(): {
  parent: string;
  app: string;
  kit: string;
  kitOld: string;
} {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'animus-srcid-')));
  tempRoots.push(parent);
  const app = join(parent, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'src', 'App.tsx'), 'export const App = 1;\n');
  const kit = join(parent, 'kits', 'ui');
  mkdirSync(join(kit, 'src'), { recursive: true });
  writeFileSync(join(kit, 'package.json'), '{"name":"ui"}');
  writeFileSync(join(kit, 'src', 'Button.tsx'), 'export const B = 1;\n');
  const kitOld = join(parent, 'kits', 'ui-old');
  mkdirSync(join(kitOld, 'src'), { recursive: true });
  writeFileSync(join(kitOld, 'src', 'Rogue.tsx'), 'export const R = 1;\n');
  return { parent, app, kit, kitOld };
}

describe('isPathWithinRoot (structural containment)', () => {
  test('posix: admits the root and its descendants only', () => {
    expect(isPathWithinRoot('/proj/ui', '/proj/ui')).toBe(true);
    expect(isPathWithinRoot('/proj/ui', '/proj/ui/src/a.ts')).toBe(true);
    expect(isPathWithinRoot('/proj/ui', '/proj')).toBe(false);
    expect(isPathWithinRoot('/proj/ui', '/proj/other/a.ts')).toBe(false);
  });

  test('posix: sibling-name roots never cross-claim (/ui vs /ui-old)', () => {
    expect(isPathWithinRoot('/proj/ui', '/proj/ui-old/a.ts')).toBe(false);
    expect(isPathWithinRoot('/proj/ui-old', '/proj/ui/a.ts')).toBe(false);
  });

  test('win32: containment is structural, sibling-safe, case-insensitive', () => {
    expect(isPathWithinRoot('C:\\proj\\ui', 'C:\\proj\\ui', win32)).toBe(true);
    expect(
      isPathWithinRoot('C:\\proj\\ui', 'C:\\proj\\ui\\src\\a.ts', win32)
    ).toBe(true);
    expect(
      isPathWithinRoot('C:\\proj\\ui', 'C:\\proj\\ui-old\\a.ts', win32)
    ).toBe(false);
    expect(isPathWithinRoot('C:\\proj\\ui', 'C:\\proj', win32)).toBe(false);
    // Same-volume requirement is a separate gate, but containment itself
    // must reject cross-drive targets (win32 relative() yields an absolute).
    expect(isPathWithinRoot('C:\\proj\\ui', 'D:\\proj\\ui\\a.ts', win32)).toBe(
      false
    );
    expect(
      isPathWithinRoot('C:\\Proj\\UI', 'c:\\proj\\ui\\src\\a.ts', win32)
    ).toBe(true);
  });
});

describe('sharesVolumeRoot (cross-volume gate, design D5)', () => {
  test('posix roots always share the single volume', () => {
    expect(sharesVolumeRoot('/proj', '/elsewhere/kit')).toBe(true);
  });

  test('win32: same drive admits, different drive rejects', () => {
    expect(sharesVolumeRoot('C:\\proj', 'C:\\kits\\ui', win32)).toBe(true);
    expect(sharesVolumeRoot('C:\\proj', 'D:\\kits\\ui', win32)).toBe(false);
    expect(sharesVolumeRoot('c:\\proj', 'C:\\kits\\ui', win32)).toBe(true);
  });

  test('win32: UNC shares are their own volume', () => {
    expect(
      sharesVolumeRoot('\\\\srv\\share\\proj', 'C:\\kits\\ui', win32)
    ).toBe(false);
    expect(
      sharesVolumeRoot('\\\\srv\\share\\proj', '\\\\srv\\share\\kits', win32)
    ).toBe(true);
    expect(
      sharesVolumeRoot('\\\\srv\\share\\proj', '\\\\srv\\other\\kits', win32)
    ).toBe(false);
  });
});

describe('createSourceIdentity', () => {
  test('derives rootDir-relative keys for project and external members', () => {
    const { app, kit } = makeTree();
    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));

    const local = identity.resolveSourceId(join(app, 'src', 'App.tsx'));
    expect(local).toEqual({
      sourceKey: join('src', 'App.tsx'),
      owningRoot: null,
      pathInRoot: join('src', 'App.tsx'),
    });

    const external = identity.resolveSourceId(join(kit, 'src', 'Button.tsx'));
    expect(external?.sourceKey).toBe(
      relative(app, join(kit, 'src', 'Button.tsx'))
    );
    expect(external?.owningRoot).toBe(realpathSync(join(kit, 'src')));
    expect(external?.pathInRoot).toBe('Button.tsx');
  });

  test('a sibling-name directory is not a member', () => {
    const { app, kit, kitOld } = makeTree();
    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));
    expect(
      identity.resolveSourceId(join(kitOld, 'src', 'Rogue.tsx'))
    ).toBeNull();
  });

  test('event spelling never forks identity (symlink alias vs canonical)', () => {
    const { parent, app, kit } = makeTree();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');

    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));

    const viaAlias = identity.resolveSourceId(join(alias, 'src', 'Button.tsx'));
    const viaCanonical = identity.resolveSourceId(
      join(kit, 'src', 'Button.tsx')
    );
    expect(viaAlias).not.toBeNull();
    expect(viaAlias).toEqual(viaCanonical);
  });

  test('a nested symlink escaping every allowed tree is rejected', () => {
    const { parent, app, kit } = makeTree();
    const outside = join(parent, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'Escape.tsx'), 'export const E = 1;\n');
    symlinkSync(outside, join(kit, 'src', 'generated'), 'dir');

    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));

    expect(
      identity.resolveSourceId(join(kit, 'src', 'generated', 'Escape.tsx'))
    ).toBeNull();
  });

  test('deletion resolves through recorded aliases only', () => {
    const { parent, app, kit } = makeTree();
    const alias = join(parent, 'link-ui');
    symlinkSync(kit, alias, 'dir');

    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));

    const recorded = identity.resolveSourceId(join(alias, 'src', 'Button.tsx'));
    expect(recorded).not.toBeNull();

    rmSync(join(kit, 'src', 'Button.tsx'));
    // The alias spelling was recorded while the file existed.
    expect(
      identity.resolveDeletedSourceId(join(alias, 'src', 'Button.tsx'))
    ).toEqual(recorded);
    // The canonical spelling was recorded as a side effect of resolution.
    expect(
      identity.resolveDeletedSourceId(join(kit, 'src', 'Button.tsx'))
    ).toEqual(recorded);
    // A spelling never seen while the file existed resolves nothing —
    // deletion never freshly canonicalizes a gone path.
    expect(
      identity.resolveDeletedSourceId(join(kit, 'src', 'Other.tsx'))
    ).toBeNull();
  });

  test('most-specific root wins and duplicate registrations collapse', () => {
    const { app, kit } = makeTree();
    const nested = join(kit, 'src', 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'Deep.tsx'), 'export const D = 1;\n');

    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));
    identity.registerExternalRoot(nested);
    // Duplicate spelling of an already-registered root collapses.
    identity.registerExternalRoot(join(kit, 'src'));
    expect(identity.externalRoots()).toHaveLength(2);

    const deep = identity.resolveSourceId(join(nested, 'Deep.tsx'));
    expect(deep?.owningRoot).toBe(realpathSync(nested));
    const shallow = identity.resolveSourceId(join(kit, 'src', 'Button.tsx'));
    expect(shallow?.owningRoot).toBe(realpathSync(join(kit, 'src')));
  });

  test('containingExternalRoot answers directory membership without file identity', () => {
    const { app, kit, kitOld } = makeTree();
    const identity = createSourceIdentity(app);
    identity.registerExternalRoot(join(kit, 'src'));

    const canonical = realpathSync(join(kit, 'src'));
    expect(identity.containingExternalRoot(join(kit, 'src'))).toBe(canonical);
    expect(identity.containingExternalRoot(join(kit, 'src', 'sub'))).toBe(
      canonical
    );
    expect(identity.containingExternalRoot(join(kitOld, 'src'))).toBeNull();
    expect(identity.containingExternalRoot(join(app, 'src'))).toBeNull();
  });
});
