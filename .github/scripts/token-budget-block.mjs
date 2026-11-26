// Writes the token budget report into a pull request description, between <!-- token-budget --> and <!-- /token-budget -->
// with a do-not-edit note on the line after the opening marker: replaces the block in place, else adds it at the bottom of
// the description. Every other byte of the body stays. Fenced code is skipped, so quoted markers stay text.
// Usage: node .github/scripts/token-budget-block.mjs <owner/repo> <pr-number> <report.md>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isMain } from './main.mjs';

const START = '<!-- token-budget -->';
const END = '<!-- /token-budget -->';
const NOTE = '<!-- Generated on every push by the token-budget workflow; do not edit. -->';

const USAGE = 'usage: node .github/scripts/token-budget-block.mjs <owner/repo> <pr-number> <report.md>';
const TRIES = 3;

// A report line that starts with a block marker would end or open a block; a leading space keeps it a hidden comment.
const MARKER_LINE = /^(?=<!-- \/?token-budget -->)/;

// The block starts with the marker and the note on whole lines: a description may name a marker in its text.
const BLOCK = /^<!-- token-budget -->\r?\n<!-- Generated on every push by the token-budget workflow; do not edit\. -->(?=\r?$)[\s\S]*?^<!-- \/token-budget -->(?=\r?$)/m;

// A fenced code block; group 3 is its closing fence, missing when the fence runs to the end, as in CommonMark.
const FENCE = /^ {0,3}((`|~)\2{2,})[^\r\n]*(?:\r?\n|(?![\s\S]))[\s\S]*?(?:(^ {0,3}\1\2*[ \t]*\r?$)|(?![\s\S]))/gm;

// Fenced code blocks are blanked, line ends kept, so the search keeps the body's offsets and skips quoted markers.
function unfenced(body) {
  return body.replace(FENCE, (fence) => fence.replace(/[^\r\n]/g, ' '));
}

// The opening fence of a code block that runs to the end of the body, if any.
function openFence(body) {
  const last = [...body.matchAll(FENCE)].at(-1);
  return last && last[3] === undefined ? last[1] : undefined;
}

export function withBlock(body, report) {
  // A description edited in the browser has CRLF line ends: the block takes the body's.
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const block = [START, NOTE, ...report.replace(/\r?\n$/, '').split(/\r?\n/).map((line) => line.replace(MARKER_LINE, ' ')), END].join(eol);
  const old = BLOCK.exec(unfenced(body));
  if (old) return body.slice(0, old.index) + block + body.slice(old.index + old[0].length);
  // A block appended inside an open fence would be code: the fence is closed first.
  const fence = openFence(body);
  const end = fence ? body + (body.endsWith(eol) ? '' : eol) + fence + eol : body;
  return end === '' ? block + eol : end + (end.endsWith(eol + eol) ? '' : end.endsWith(eol) ? eol : eol + eol) + block + eol;
}

// Writes the block, then reads the description again: a review bot may have written an older body in between.
// Writes again while the block is missing or stale, and throws after `tries` writes.
export async function publish({ read, write, report, tries = TRIES }) {
  let body = await read();
  for (let attempt = 1; attempt <= tries; attempt++) {
    await write(withBlock(body, report));
    body = await read();
    if (withBlock(body, report) === body) return attempt;
  }
  throw new Error(`the token budget block is still missing or stale after ${tries} writes: another writer keeps replacing the description`);
}

if (isMain(import.meta.url)) {
  const [repo, pr, file] = process.argv.slice(2);
  if (!file) {
    console.error(USAGE);
    process.exit(2);
  }
  const gh = (args, input) => execFileSync('gh', [...args, pr, '--repo', repo], { encoding: 'utf8', input });
  try {
    await publish({
      read: () => JSON.parse(gh(['pr', 'view', '--json', 'body'])).body ?? '',
      write: (body) => gh(['pr', 'edit', '--body-file', '-'], body),
      report: readFileSync(file, 'utf8'),
    });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
