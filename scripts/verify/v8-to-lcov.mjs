#!/usr/bin/env node
// Remap NODE_V8_COVERAGE dumps to source-level lcov.
//
// Two paths per script, chosen by comparing the executed script's extent to
// the on-disk file size:
//
// CLEAN (extent matches disk): the script ran from disk, so its cached
// sourcemap positions are valid — remap per line via the source-map cache
// Node captured (lineLengths + map data).
//
// TRANSFORMED (extent mismatch): Next's next.config.ts require hook SWC-
// recompiles every module the config pulls in (mod._compile under the same
// filename), and the resulting composed sourcemap positions are unreliable.
// The V8 function records are still complete and correct, so fall back to
// function granularity: match named records to declaration lines in the
// original sources (order-preserving name search) and paint each function's
// span with its execution count.
//
// Usage: node v8-to-lcov.mjs <raw-dir> <out-lcov> <repo-root>

import { TraceMap, decodedMappings } from '@jridgewell/trace-mapping';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [rawDir, outFile, rootArg] = process.argv.slice(2);
if (!rawDir || !outFile || !rootArg) {
  console.error('usage: v8-to-lcov.mjs <raw-dir> <out-lcov> <repo-root>');
  process.exit(2);
}
const rootUrl = pathToFileURL(`${rootArg}/`).href;
const EXTENT_TOLERANCE = 300; // CJS wrapper / BOM slack

// srcPath -> { lines: Map(line -> max count), granularity: Set<string> }
const files = new Map();
const record = (srcPath, line, count, granularity) => {
  let entry = files.get(srcPath);
  if (!entry)
    files.set(srcPath, (entry = { lines: new Map(), tags: new Set() }));
  entry.lines.set(line, Math.max(entry.lines.get(line) ?? 0, count));
  entry.tags.add(granularity);
};

const srcCache = new Map();
const readSrc = (path) => {
  if (!srcCache.has(path)) {
    try {
      srcCache.set(path, readFileSync(join(rootArg, path), 'utf8').split('\n'));
    } catch {
      srcCache.set(path, null);
    }
  }
  return srcCache.get(path);
};

const resolveSources = (tracer, scriptUrl) =>
  tracer.resolvedSources.map((s) => {
    try {
      const path = s.startsWith('file:')
        ? fileURLToPath(s)
        : fileURLToPath(new URL(s, scriptUrl));
      const rel = relative(rootArg, path);
      return rel.startsWith('..') || rel.includes('node_modules') ? null : rel;
    } catch {
      return null;
    }
  });

// --- CLEAN path: per-line remap through the cached (valid) sourcemap -------

const remapLines = (script, sm) => {
  const lineStarts = [0];
  for (const len of sm.lineLengths) {
    lineStarts.push(lineStarts[lineStarts.length - 1] + len + 1);
  }
  const total = lineStarts[lineStarts.length - 1];
  const counts = new Int32Array(total).fill(-1);
  const ranges = [];
  for (const fn of script.functions ?? []) {
    for (const r of fn.ranges) ranges.push(r);
  }
  ranges.sort(
    (a, b) => b.endOffset - b.startOffset - (a.endOffset - a.startOffset)
  );
  for (const r of ranges) {
    counts.fill(r.count, r.startOffset, Math.min(r.endOffset, total));
  }
  // Sample at the segment's exact generated column: one generated line can
  // mix executed definition-site tokens with never-called function-body
  // tokens, so any per-line aggregate smears counts across source lines.
  const countAt = (line, col) => {
    const lineEnd = Math.min(lineStarts[line + 1] - 1, total);
    for (let i = lineStarts[line] + col; i < lineEnd; i++) {
      if (counts[i] >= 0) return counts[i];
    }
    return -1;
  };

  let tracer;
  try {
    tracer = new TraceMap(sm.data);
  } catch {
    return;
  }
  const sources = resolveSources(tracer, script.url);
  const mappings = decodedMappings(tracer);
  for (let genLine = 0; genLine < mappings.length; genLine++) {
    const segments = mappings[genLine];
    if (!segments?.length) continue;
    for (const seg of segments) {
      if (seg.length < 4) continue;
      const count = countAt(genLine, seg[0]);
      if (count < 0) continue;
      const srcPath = sources[seg[1]];
      if (!srcPath?.startsWith('packages/')) continue;
      record(srcPath, seg[2] + 1, count, 'line');
    }
  }
};

// --- TRANSFORMED path: function-granularity by declaration-name matching ---

const DECL_PREFIX =
  '^\\s*(?:export\\s+)?(?:default\\s+)?(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|override\\s+)*(?:async\\s+)?(?:function\\s*\\*?\\s*)?';

const remapFunctions = (script, sm) => {
  let tracer;
  try {
    tracer = new TraceMap(sm.data);
  } catch {
    return;
  }
  const sources = resolveSources(tracer, script.url).filter((s) =>
    s?.startsWith('packages/')
  );
  if (!sources.length) return;

  // Ordered declaration inventory across the bundle's sources (bundle
  // concatenation preserves source order).
  const decls = [];
  for (const srcPath of sources) {
    const lines = readSrc(srcPath);
    if (!lines) continue;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(
        new RegExp(
          `${DECL_PREFIX}(?:get\\s+|set\\s+)?([A-Za-z_$][\\w$]*)\\s*[<(=]`
        )
      );
      if (m) decls.push({ name: m[1], srcPath, line: i + 1, used: false });
    }
  }

  const named = (script.functions ?? [])
    .filter(
      (fn) => fn.functionName && /^[A-Za-z_$][\w$]*$/.test(fn.functionName)
    )
    .map((fn) => ({
      name: fn.functionName,
      start: fn.ranges[0].startOffset,
      count: fn.ranges[0].count,
    }))
    .sort((a, b) => a.start - b.start);

  // Order-preserving greedy match: executed order follows declaration order.
  let cursor = 0;
  const matches = [];
  for (const fn of named) {
    let idx = decls.findIndex(
      (d, i) => i >= cursor && !d.used && d.name === fn.name
    );
    if (idx === -1) {
      idx = decls.findIndex((d) => !d.used && d.name === fn.name);
    }
    if (idx === -1) continue;
    decls[idx].used = true;
    matches.push({ ...fn, srcPath: decls[idx].srcPath, line: decls[idx].line });
    cursor = Math.max(cursor, idx + 1);
  }

  // Paint each function's span (decl line -> line before the next matched
  // decl in the same file) with its count. Function granularity: interior
  // branch detail is intentionally not claimed.
  matches.sort((a, b) =>
    a.srcPath === b.srcPath ? a.line - b.line : a.srcPath < b.srcPath ? -1 : 1
  );
  for (let i = 0; i < matches.length; i++) {
    const fn = matches[i];
    const next = matches[i + 1];
    const fileLines = readSrc(fn.srcPath)?.length ?? fn.line;
    const end = next && next.srcPath === fn.srcPath ? next.line - 1 : fileLines;
    for (let line = fn.line; line <= end; line++) {
      record(fn.srcPath, line, fn.count, 'fn');
    }
  }
};

// --- main -------------------------------------------------------------------

for (const name of readdirSync(rawDir)) {
  if (!/^coverage-.*\.json$/.test(name)) continue;
  let dump;
  try {
    dump = JSON.parse(readFileSync(join(rawDir, name), 'utf8'));
  } catch {
    continue; // partial flush from a killed worker
  }
  const cache = dump['source-map-cache'] ?? {};
  for (const script of dump.result ?? []) {
    const sm = cache[script.url];
    if (!sm?.data || !sm.lineLengths || !script.url.startsWith(rootUrl)) {
      continue;
    }
    let diskSize = null;
    try {
      diskSize = statSync(fileURLToPath(script.url)).size;
    } catch {
      // transient artifact (e.g. next.config.compiled.js) — treat as transformed
    }
    const extent = Math.max(
      ...(script.functions ?? []).flatMap((fn) =>
        fn.ranges.map((r) => r.endOffset)
      )
    );
    if (diskSize !== null && Math.abs(extent - diskSize) <= EXTENT_TOLERANCE) {
      remapLines(script, sm);
    } else {
      remapFunctions(script, sm);
    }
  }
}

let out = '';
const summary = [];
for (const [path, { lines, tags }] of [...files].sort()) {
  const ordered = [...lines.keys()].sort((a, b) => a - b);
  let hit = 0;
  out += `TN:\nSF:${path}\n`;
  for (const line of ordered) {
    const count = lines.get(line);
    if (count > 0) hit++;
    out += `DA:${line},${count}\n`;
  }
  out += `LF:${ordered.length}\nLH:${hit}\nend_of_record\n`;
  summary.push(
    `${path}  ${hit}/${ordered.length} lines (${Math.round((hit / ordered.length) * 100)}%) [${[...tags].join('+')}]`
  );
}
writeFileSync(outFile, out);
console.log(summary.join('\n'));
console.log(`wrote ${outFile}: ${files.size} source files`);
