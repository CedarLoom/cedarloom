// Puts the token budget report into a pull request description, between <!-- token-budget --> and <!-- /token-budget -->:
// replaces the block in place, else inserts it after the ELI5 section, else at the top. Every other byte of the body stays.
// Usage: node .github/scripts/token-budget-block.mjs <pr.json> <report.md>   (pr.json: `gh pr view --json body`; prints the new body)
import { readFileSync } from 'node:fs';
import { isMain } from './main.mjs';

const START = '<!-- token-budget -->';
const END = '<!-- /token-budget -->';
const NOTE = '<!-- Generated on every push by the token-budget workflow; do not edit. -->';

export function withBlock(body, report) {
  // A description edited in the browser has CRLF line ends: the block takes the body's.
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const block = [START, NOTE, ...report.replace(/\r?\n$/, '').split(/\r?\n/), END].join(eol);
  // Markers count only as whole lines: a description may name them in its text.
  const old = /^<!-- token-budget -->(?=\r?$)[\s\S]*?^<!-- \/token-budget -->(?=\r?$)/m.exec(body);
  if (old) return body.slice(0, old.index) + block + body.slice(old.index + old[0].length);
  const eli5 = /^(#{1,6})[ \t]+ELI5[ \t]*\r?$/im.exec(body);
  if (!eli5) return body === '' ? block + eol : block + eol + eol + body;
  // The section ends at the next heading of the same or a higher level.
  const after = eli5.index + eli5[0].length;
  const next = new RegExp(`^#{1,${eli5[1].length}}[ \\t]`, 'm').exec(body.slice(after));
  if (next) return body.slice(0, after + next.index) + block + eol + eol + body.slice(after + next.index);
  const gap = body.endsWith(eol + eol) ? '' : body.endsWith(eol) ? eol : eol + eol;
  return body + gap + block + eol;
}

if (isMain(import.meta.url)) {
  const [pr, report] = process.argv.slice(2);
  if (!pr || !report) {
    console.error('usage: node .github/scripts/token-budget-block.mjs <pr.json> <report.md>');
    process.exit(2);
  }
  process.stdout.write(withBlock(JSON.parse(readFileSync(pr, 'utf8')).body ?? '', readFileSync(report, 'utf8')));
}
