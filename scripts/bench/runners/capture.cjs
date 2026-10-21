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
  const record = (engine, files, evidence) =>
    writeFileSync(
      out,
      JSON.stringify({ config: engine.benchConfig, files, evidence })
    );
  const Captured = class extends Engine {
    constructor(config) {
      super(config);
      this.benchConfig = config;
    }
    prepare(files) {
      this.benchFiles = files;
      return super.prepare(files);
    }
    analyze(files, evidence) {
      record(this, files, evidence);
      return super.analyze(files, evidence);
    }
  };
  // A host that prepares sends the files once, to `prepare`; only an engine
  // that has `analyzePrepared` is offered it.
  if ('analyzePrepared' in Engine.prototype) {
    Captured.prototype.analyzePrepared = function analyzePrepared(evidence) {
      record(this, this.benchFiles, evidence);
      return Engine.prototype.analyzePrepared.call(this, evidence);
    };
  }
  exports.ExtractEngine = Captured;
  return exports;
};
