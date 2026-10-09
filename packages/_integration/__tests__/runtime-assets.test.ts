import { generatedModuleCode } from '@animus-ui/extract/pipeline';
import { asset, createSystem, createTheme } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { analyzeProject } from './run-pipeline';

/**
 * A scale value holding asset() reaches runtime configs as a root variable
 * the global sheet declares, so the sheets' substitution step resolves it.
 */
const assetSystem = () => {
  const theme = createTheme()
    .addScale({
      name: 'images',
      values: {
        rock: `url("${asset('@acme/media/rock.jpg')}")`,
        none: 'none',
      },
    })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('probe', {
      bgImage: { property: 'backgroundImage', scale: 'images' },
    })
    .build()
    .seal()
    .toConfig();
  return {
    ...theme,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
  };
};

test('a runtime-selected asset scale value reads a root variable of the global sheet', () => {
  const source = `import { ds } from './setup';
export const Box = ds
  .props({ texture: { property: 'maskImage', scale: 'images' } })
  .system({ probe: true })
  .asElement('div');
export const App = ({ n }) => <Box bgImage={n} texture={n} />;`;
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'fixtures/runtime-assets.tsx', source }]),
      assetSystem()
    )
  );

  const reference = manifest.dynamic_props.bgImage.scaleValues.rock;
  expect(reference).toMatch(/^var\(--animus-asset-[0-9a-f]{8}\)$/);
  expect(manifest.dynamic_props.bgImage.scaleValues.none).toBe('none');
  const name = reference.slice('var('.length, -1);
  expect(manifest.sheets.global).toContain(
    `${name}: url("animus-asset:@acme/media/rock.jpg");`
  );
  const replacement: string =
    manifest.components['fixtures/runtime-assets.tsx::Box'].replacement;
  expect(replacement).toContain(`"rock":"${reference}"`);
  expect(generatedModuleCode(manifest)).not.toContain('animus-asset:');
});
