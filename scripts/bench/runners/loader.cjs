// verify:bench loader row: one native loadSystemModule in this fresh
// process. Prints one JSON line: elapsed ms, the dependency paths it read
// (count and digest, relative to the root) and a digest of the config.
// Usage: node loader.cjs <extract package dir> <system path> <root dir>

const { createHash } = require('node:crypto');
const { relative } = require('node:path');

const [extractDir, systemPath, rootDir] = process.argv.slice(2);
const native = require(extractDir);
const digest = (value) => createHash('sha256').update(value).digest('hex');

const start = process.hrtime.bigint();
const config = native.loadSystemModule(systemPath, rootDir);
const ms = Number(process.hrtime.bigint() - start) / 1e6;

const dependencies = (config.dependencies ?? [])
  .map((path) => relative(rootDir, path))
  .sort();
const { dependencies: _read, missing: _missing, ...rest } = config;
process.stdout.write(
  `${JSON.stringify({
    ms,
    receipt: {
      dependencies: dependencies.length,
      dependencyDigest: digest(dependencies.join('\n')),
      configDigest: digest(JSON.stringify(rest)),
    },
  })}\n`
);
