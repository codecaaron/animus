'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const Module = require('node:module');
const { join } = require('node:path');

const captureDirectory = process.env.ANIMUS_RESIDUE_CAPTURE_DIR;
const rawLabel = process.env.ANIMUS_RESIDUE_CAPTURE_LABEL || 'manifest';
const label =
  rawLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'manifest';
const patched = Symbol.for('animus.residue.capture.patched');
const originalLoad = Module._load;
let captureCount = 0;

function patchExtractEngine(loaded) {
  const prototype = loaded?.ExtractEngine?.prototype;
  if (
    captureDirectory &&
    prototype &&
    typeof prototype.analyze === 'function' &&
    !prototype[patched]
  ) {
    const analyze = prototype.analyze;
    Object.defineProperty(prototype, patched, { value: true });
    prototype.analyze = function analyzeAndCapture(...args) {
      const result = analyze.apply(this, args);
      JSON.parse(result);
      mkdirSync(captureDirectory, { recursive: true });
      captureCount += 1;
      writeFileSync(
        join(captureDirectory, `${label}-${process.pid}-${captureCount}.json`),
        `${result}\n`,
        'utf8'
      );
      return result;
    };
  }
}

if (captureDirectory) {
  const captureModule =
    process.env.ANIMUS_RESIDUE_CAPTURE_MODULE ||
    '@animus-ui/extract/engine-v2';
  try {
    patchExtractEngine(require(captureModule));
  } catch {
    // The loader hook below patches the engine when its owning process resolves it.
  }

  Module._load = function captureExtractEngine(request, parent, isMain) {
    const loaded = originalLoad.call(this, request, parent, isMain);
    patchExtractEngine(loaded);
    return loaded;
  };
}
