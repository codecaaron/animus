import { unstable_readConfig } from 'wrangler';

const configPath = process.argv[2];

if (!configPath) {
  console.error('ERROR: read-worker-name expects a Wrangler config path');
  process.exit(2);
}

try {
  const config = unstable_readConfig(
    { config: configPath },
    { hideWarnings: true }
  );
  const name = config.name;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error(`${configPath} has no non-empty top-level Worker name`);
  }

  process.stdout.write(`${name}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: unable to read Worker name: ${message}`);
  process.exit(1);
}
