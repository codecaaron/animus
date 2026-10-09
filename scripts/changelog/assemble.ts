#!/usr/bin/env bun

// Moves changes/unreleased/*.md into CHANGELOG.md, or validates them under
// --check. Format and workflow: AGENTS.md § Changelog Entries.

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const FRAGMENT_DIRECTORY = 'changes/unreleased';

interface Fragment {
  name: string;
  text: string;
}

const FRAGMENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// A bold lead may wrap across lines, as the changelog's own leads do.
const BOLD_LEAD = /^\*\*[^*\s][\s\S]*?\*\*/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const UNRELEASED_HEADING = /^## Unreleased[ \t]*$/m;
const SECTION_HEADING = /^## /m;

// Hidden files are editor and OS litter (.DS_Store), never entries.
function readFragments(directory: string): Fragment[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .map((name) => ({
      name,
      text: readFileSync(join(directory, name), 'utf8'),
    }));
}

// ATX headings (`### Details`), and setext headings: a text line underlined
// by `===` or `---`. After a blank line, `---` is a thematic break instead.
function headingLines(text: string): number[] {
  const lines: number[] = [];
  let fence: string | undefined;
  let afterText = false;
  text.split('\n').forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1]?.[0];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      afterText = false;
    } else if (fence === undefined) {
      const atx = HEADING.test(line);
      const underline = afterText && SETEXT_UNDERLINE.test(line);
      if (atx) lines.push(index + 1);
      if (underline) lines.push(index);
      afterText = !atx && !underline && line.trim() !== '';
    }
  });
  return lines;
}

function fragmentProblems(fragment: Fragment): string[] {
  const problems: string[] = [];
  if (!FRAGMENT_NAME.test(fragment.name)) {
    problems.push(
      'the name must be a lowercase kebab-case slug ending in .md, such as wrapper-props.md'
    );
  }
  const entry = fragment.text.trim();
  if (entry === '') return [...problems, 'it is empty'];
  if (!BOLD_LEAD.test(entry)) {
    problems.push(
      'it must open with a bold lead, such as **What changed.** followed by the details'
    );
  }
  for (const line of headingLines(fragment.text)) {
    problems.push(
      `line ${line} is a heading; an entry sits inside ## Unreleased and cannot open a section`
    );
  }
  return problems;
}

function checkFragments(fragments: readonly Fragment[]): string[] {
  return fragments.flatMap((fragment) =>
    fragmentProblems(fragment).map((problem) => `${fragment.name}: ${problem}`)
  );
}

// Blank-line-separated Markdown blocks. Only the newlines between blocks
// change, so text already in the changelog keeps its bytes.
function joinBlocks(blocks: readonly string[]): string {
  return `${blocks
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block !== '')
    .join('\n\n')}\n`;
}

// Entries go above the paragraphs already under `## Unreleased` in file-name
// order, so the output depends only on the fragments, never on the order a
// directory listing returns them in. Without that section, a new one opens
// above the newest release.
function assembleChangelog(
  changelog: string,
  fragments: readonly Fragment[]
): string {
  const unreleased = UNRELEASED_HEADING.exec(changelog);
  const at = unreleased
    ? unreleased.index + unreleased[0].length
    : (SECTION_HEADING.exec(changelog)?.index ?? changelog.length);
  return joinBlocks([
    changelog.slice(0, at),
    ...(unreleased ? [] : ['## Unreleased']),
    ...[...fragments]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((fragment) => fragment.text.trim()),
    changelog.slice(at),
  ]);
}

function main(root: string, args: readonly string[]): number {
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`ERROR: unknown argument ${unknown.join(' ')}`);
    console.error('Usage: bun scripts/changelog/assemble.ts [--check]');
    return 2;
  }

  const directory = join(root, FRAGMENT_DIRECTORY);
  const fragments = readFragments(directory);
  const problems = checkFragments(fragments);
  if (problems.length > 0) {
    console.error(
      `ERROR: malformed changelog entries in ${FRAGMENT_DIRECTORY}/`
    );
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  if (fragments.length === 0 || args.includes('--check')) {
    console.log(
      `[changelog] ${fragments.length} well-formed entries in ${FRAGMENT_DIRECTORY}/`
    );
    return 0;
  }

  const changelogPath = join(root, 'CHANGELOG.md');
  writeFileSync(
    changelogPath,
    assembleChangelog(readFileSync(changelogPath, 'utf8'), fragments)
  );
  for (const fragment of fragments) rmSync(join(directory, fragment.name));
  console.log(
    `[changelog] moved ${fragments.length} entries into CHANGELOG.md`
  );
  return 0;
}

if (import.meta.main) {
  process.exit(
    main(resolve(import.meta.dirname, '../..'), process.argv.slice(2))
  );
}
