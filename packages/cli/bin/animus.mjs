#!/usr/bin/env node
// Thin shebang shim; the built entry owns arg parsing, exit codes, and
// stream discipline. The one decision that cannot live there is what a
// failure to LOAD that entry means. Exit 4 is the install/load class —
// EXIT_INSTALL in src/index.ts, repeated as a literal here because the
// module that declares it is exactly the one that did not load — where the
// default rejection exit of 1 is the extraction-failure class a supervisor
// retries forever. stderr is written directly for the same reason.
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
