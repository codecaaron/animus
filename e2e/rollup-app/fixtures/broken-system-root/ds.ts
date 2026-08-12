// Deliberately failing system module: the system-load-fatal negative
// (inc 03 recorded gap) — evaluation throws before any SystemInstance
// exists, so `animus build` over this root must exit 1 WITHOUT --strict;
// system-load failure is fatal in every mode. (A top-level throw rather
// than a parse error keeps the repo linters out of the fixture.)
throw new Error('broken-system fixture: deliberate load failure');
