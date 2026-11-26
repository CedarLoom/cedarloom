import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { publish, withBlock } from './token-budget-block.mjs';

const SCRIPT = fileURLToPath(new URL('./token-budget-block.mjs', import.meta.url));

const NOTE = '<!-- Generated on every push by the token-budget workflow; do not edit. -->';
const TB = (r) => `<!-- token-budget -->\n${NOTE}\n${r}\n<!-- /token-budget -->`;

test('without a block, it goes at the end of the description', () => {
  assert.equal(withBlock('## ELI5\n\nShort.\n\n## What changed\n\n- a\n', '| total | 1 |\n'), `## ELI5\n\nShort.\n\n## What changed\n\n- a\n\n${TB('| total | 1 |')}\n`);
  assert.equal(withBlock('## Why\nx\n\n', 'r'), `## Why\nx\n\n${TB('r')}\n`);
  assert.equal(withBlock('', 'r'), `${TB('r')}\n`);
});

test('an existing block is replaced in place and the text around it stays', () => {
  const body = `## ELI5\n\nShort.\n\n${TB('old')}\n\n## What changed\nkept`;
  assert.equal(withBlock(body, 'new\n'), `## ELI5\n\nShort.\n\n${TB('new')}\n\n## What changed\nkept`);
});

test('markers named inside a line are text, not a block', () => {
  const body = 'The `<!-- token-budget -->` and `<!-- /token-budget -->` lines.\n';
  assert.equal(withBlock(body, 'r'), `${body}\n${TB('r')}\n`);
});

test('a CRLF body gets a CRLF block', () => {
  assert.equal(withBlock('## ELI5\r\n\r\nShort.', 'a\nb\n'), `## ELI5\r\n\r\nShort.\r\n\r\n${TB('a\nb').replaceAll('\n', '\r\n')}\r\n`);
});

test('an opening marker quoted alone in a fence is text, also on the next run', () => {
  const body = 'Intro\n```\n<!-- token-budget -->\n```\n## Next\nx\n';
  const first = withBlock(body, 'r1');
  assert.equal(first, `${body}\n${TB('r1')}\n`);
  assert.equal(withBlock(first, 'r2'), first.replace('r1', 'r2'));
});

test('a whole example block quoted in a fence is text', () => {
  const example = `~~~md\n${TB('example')}\n~~~\n`;
  assert.equal(withBlock(`## Docs\n${example}`, 'r'), `## Docs\n${example}\n${TB('r')}\n`);
});

test('a fence open to the end is closed before the appended block, which the next run replaces', () => {
  const first = withBlock('Intro\n````js\nexample\n', 'r1');
  assert.equal(first, `Intro\n\`\`\`\`js\nexample\n\`\`\`\`\n\n${TB('r1')}\n`);
  assert.equal(withBlock(first, 'r2'), first.replace('r1', 'r2'));
  assert.equal(withBlock('Intro\n~~~', 'r'), `Intro\n~~~\n~~~\n\n${TB('r')}\n`);
});

test('marker lines in the report neither end the block nor open another', async () => {
  const report = `r\n<!-- /token-budget -->\ntail\n<!-- token-budget -->\n${NOTE}\nfake\n<!-- /token-budget --> x\n`;
  const inner = `r\n <!-- /token-budget -->\ntail\n <!-- token-budget -->\n${NOTE}\nfake\n <!-- /token-budget --> x`;
  let stored = '## Why\n';
  const tries = await publish({ read: () => stored, write: (body) => { stored = body; }, report });
  assert.equal(tries, 1);
  assert.equal(stored, `## Why\n\n${TB(inner)}\n`);
  assert.equal(withBlock(stored, 'r2'), `## Why\n\n${TB('r2')}\n`);
});

test('a concurrent overwrite that drops the block gets one more write', async () => {
  let stored = '## ELI5\nShort.\n';
  const stale = stored;
  const writes = [];
  const tries = await publish({
    read: () => stored,
    write: (body) => {
      writes.push(body);
      // A review bot wrote the body it read before this write, with its own summary.
      stored = writes.length === 1 ? `${stale}\nSummary.\n` : body;
    },
    report: 'r',
  });
  assert.equal(tries, 2);
  assert.equal(stored, `## ELI5\nShort.\n\nSummary.\n\n${TB('r')}\n`);
});

test('a block still missing after three writes fails', async () => {
  await assert.rejects(
    publish({ read: () => '## ELI5\n', write: () => {}, report: 'r' }),
    { message: 'the token budget block is still missing or stale after 3 writes: another writer keeps replacing the description' },
  );
});

test('the command line writes the block through gh, and prints the usage without its arguments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-budget-block-'));
  try {
    // A stand-in gh: `pr view` prints the stored body as JSON, `pr edit --body-file -` stores standard input.
    const store = join(dir, 'body.md');
    writeFileSync(store, '## What changed\n- a');
    writeFileSync(
      join(dir, 'gh'),
      `#!${process.execPath}\nconst fs = require('node:fs');\nconst store = ${JSON.stringify(store)};\nif (process.argv[3] === 'view') process.stdout.write(JSON.stringify({ body: fs.readFileSync(store, 'utf8') }));\nelse fs.writeFileSync(store, fs.readFileSync(0, 'utf8'));\n`,
    );
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(join(dir, 'report.md'), 'r\n');
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    const ok = run('owner/repo', '7', join(dir, 'report.md'));
    assert.equal(ok.status, 0);
    assert.equal(readFileSync(store, 'utf8'), `## What changed\n- a\n\n${TB('r')}\n`);
    const usage = run('owner/repo', '7');
    assert.equal(usage.status, 2);
    assert.equal(usage.stderr, 'usage: node .github/scripts/token-budget-block.mjs <owner/repo> <pr-number> <report.md>\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
