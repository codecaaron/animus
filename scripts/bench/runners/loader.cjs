// verify:bench loader row: one native loadSystemModule in this fresh
// process. Prints one JSON line: elapsed ms, the dependency paths it read
// (count and digest) and a digest of the config, every path in either
// relative to the repository, so a receipt is the same in any checkout and
// on any platform.
// Usage: node loader.cjs <extract package dir> <system path> <root dir>

const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');
const { resolve, sep } = require('node:path');

const [extractDir, systemPath, rootDir] = process.argv.slice(2);
const native = require(extractDir);
const digest = (value) => createHash('sha256').update(value).digest('hex');

const start = process.hrtime.bigint();
const config = native.loadSystemModule(systemPath, rootDir);
const ms = Number(process.hrtime.bigint() - start) / 1e6;

// The repository the bench runs in, as written and at its real path: the
// fixtures and every package they read lie below it.
const repo = resolve(__dirname, '../../..');
const roots = [...new Set([repo, realpathSync(repo)])]
  .sort((a, b) => b.length - a.length)
  .map((root) => root + sep);
const local = (text) =>
  roots.reduce((out, root) => out.split(root).join(''), text);

const dependencies = (config.dependencies ?? [])
  .map((path) => local(path).split(sep).join('/'))
  .sort();
const { dependencies: _read, missing: _missing, ...rest } = config;
process.stdout.write(
  `${JSON.stringify({
    ms,
    receipt: {
      dependencies: dependencies.length,
      dependencyDigest: digest(dependencies.join('\n')),
      configDigest: digest(local(JSON.stringify(rest))),
    },
  })}\n`
);
