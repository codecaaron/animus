// verify:bench analysis row: one native analysis in this fresh process and
// a fresh engine, over a captured input (see capture.cjs). Constructing the
// engine is outside the timed interval; `prepare`, where the engine has it,
// and `analyze` are inside. Prints one JSON line: elapsed ms and a receipt
// of the emitted manifest.
// Usage: node analysis.cjs <extract package dir> <captured input>

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

const [extractDir, inputPath] = process.argv.slice(2);
const native = require(extractDir);
const { config, files, evidence } = JSON.parse(readFileSync(inputPath, 'utf8'));

const engine = new native.ExtractEngine(config);
const start = process.hrtime.bigint();
if ('prepare' in engine) engine.prepare(files);
const manifestJson = engine.analyze(files, evidence ?? undefined);
const ms = Number(process.hrtime.bigint() - start) / 1e6;

// The manifest's own timing differs run to run; the digest covers the rest.
const { timing: _timing, ...manifest } = JSON.parse(manifestJson);
process.stdout.write(
  `${JSON.stringify({
    ms,
    receipt: {
      components: Object.keys(manifest.components ?? {}).length,
      cssBytes: Buffer.byteLength(manifest.css ?? ''),
      diagnostics: (manifest.diagnostics ?? []).length,
      manifestDigest: createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex'),
    },
  })}\n`
);
