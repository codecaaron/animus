#!/usr/bin/env node
// Thin shebang shim — the built entry owns everything (arg parsing, exit
// codes, stream discipline). Kept as a plain file so the bin needs no
// build-time banner injection.
import('../dist/index.mjs').then((mod) => mod.main());
