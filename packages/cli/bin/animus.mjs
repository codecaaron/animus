#!/usr/bin/env node
// The literal repeats EXIT_INSTALL (src/index.ts) because that module is the
// one that did not load; the default rejection exit 1 reads as extraction.
import('../dist/index.mjs').then(
  (mod) => mod.main(),
  (error) => {
    process.stderr.write(
      `[animus] The @animus-ui/cli install could not be loaded: ${String(error)}\n` +
        '[animus] This is an install failure, not an extraction failure — ' +
        'reinstall @animus-ui/cli and check that its dist/ shipped.\n'
    );
    process.exit(4);
  }
);
