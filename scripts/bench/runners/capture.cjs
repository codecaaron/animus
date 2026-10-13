// verify:bench analysis fixture: preloaded (`node --require`) into a host
// build, records the last ExtractEngine analysis it runs — the engine
// config, the files and the probe evidence — to ANIMUS_BENCH_CAPTURE, as
// the fixed serialized input the analysis row replays.

const Module = require('node:module');
const { writeFileSync } = require('node:fs');

const out = process.env.ANIMUS_BENCH_CAPTURE;
const wrapped = new WeakSet();
const load = Module._load;

Module._load = function capture(request, parent, isMain) {
  const exports = load.call(this, request, parent, isMain);
  // The engine module is the one exporting ExtractEngine.
  const Engine = exports?.ExtractEngine;
  if (out === undefined || Engine === undefined || wrapped.has(exports))
    return exports;
  wrapped.add(exports);
  exports.ExtractEngine = class extends Engine {
    constructor(config) {
      super(config);
      this.benchConfig = config;
    }
    analyze(files, evidence) {
      writeFileSync(
        out,
        JSON.stringify({ config: this.benchConfig, files, evidence })
      );
      return super.analyze(files, evidence);
    }
  };
  return exports;
};
