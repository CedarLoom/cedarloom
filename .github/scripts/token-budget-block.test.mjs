import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withBlock } from './token-budget-block.mjs';

const SCRIPT = fileURLToPath(new URL('./token-budget-block.mjs', import.meta.url));

const NOTE = '<!-- Generated on every push by the token-budget workflow; do not edit. -->';

test('without a block, it goes after the ELI5 section', () => {
  const body = '## ELI5\n\nShort.\n\n## What changed\n\n- a\n';
  assert.equal(withBlock(body, '| total | 1 |\n'), `## ELI5\n\nShort.\n\n<!-- token-budget -->\n${NOTE}\n| total | 1 |\n<!-- /token-budget -->\n\n## What changed\n\n- a\n`);
});

test('an existing block is replaced in place and the text around it stays', () => {
  const body = `## ELI5\n\nShort.\n\n<!-- token-budget -->\n${NOTE}\nold\n<!-- /token-budget -->\n\n## What changed\nkept`;
  assert.equal(withBlock(body, 'new\n'), `## ELI5\n\nShort.\n\n<!-- token-budget -->\n${NOTE}\nnew\n<!-- /token-budget -->\n\n## What changed\nkept`);
});

test('markers named inside a line are text, not a block', () => {
  const body = '## ELI5\nThe `<!-- token-budget -->` and `<!-- /token-budget -->` lines.\n## Why\n';
  assert.equal(withBlock(body, 'r'), `## ELI5\nThe \`<!-- token-budget -->\` and \`<!-- /token-budget -->\` lines.\n<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n## Why\n`);
});

test('a body without an ELI5 section gets the block at the top', () => {
  assert.equal(withBlock('## What changed\n- a', 'r'), `<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n## What changed\n- a`);
});

test('a CRLF body gets a CRLF block, also when ELI5 is its last section', () => {
  assert.equal(withBlock('## ELI5\r\n\r\nShort.', 'a\nb\n'), `## ELI5\r\n\r\nShort.\r\n\r\n<!-- token-budget -->\r\n${NOTE}\r\na\r\nb\r\n<!-- /token-budget -->\r\n`);
});

test('a subheading inside the ELI5 section does not end it', () => {
  assert.equal(withBlock('## ELI5\n### Detail\nx\n# Next\n', 'r'), `## ELI5\n### Detail\nx\n<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n# Next\n`);
});

test('an opening marker quoted alone in a fence above ELI5 is text, also on the next run', () => {
  const body = 'Intro\n```\n<!-- token-budget -->\n```\n## ELI5\nkeep me\n## Next\nx\n';
  const first = withBlock(body, 'r1');
  assert.equal(first, `Intro\n\`\`\`\n<!-- token-budget -->\n\`\`\`\n## ELI5\nkeep me\n<!-- token-budget -->\n${NOTE}\nr1\n<!-- /token-budget -->\n\n## Next\nx\n`);
  assert.equal(withBlock(first, 'r2'), first.replace('r1', 'r2'));
});

test('a whole example block quoted in a fence is text', () => {
  const example = `~~~md\n<!-- token-budget -->\n${NOTE}\nexample\n<!-- /token-budget -->\n~~~\n`;
  assert.equal(withBlock(`## ELI5\nshort\n## Docs\n${example}`, 'r'), `## ELI5\nshort\n<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n## Docs\n${example}`);
});

test('a heading line inside a fence does not end the ELI5 section', () => {
  assert.equal(withBlock('## ELI5\n```sh\n# run\n```\n## Next\n', 'r'), `## ELI5\n\`\`\`sh\n# run\n\`\`\`\n<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n## Next\n`);
});

test('the command line prints the new body, and the usage without both files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-budget-block-'));
  try {
    writeFileSync(join(dir, 'pr.json'), JSON.stringify({ body: '## What changed\n- a' }));
    writeFileSync(join(dir, 'report.md'), 'r\n');
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const ok = run(join(dir, 'pr.json'), join(dir, 'report.md'));
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout, `<!-- token-budget -->\n${NOTE}\nr\n<!-- /token-budget -->\n\n## What changed\n- a`);
    const usage = run(join(dir, 'pr.json'));
    assert.equal(usage.status, 2);
    assert.equal(usage.stdout, '');
    assert.equal(usage.stderr, 'usage: node .github/scripts/token-budget-block.mjs <pr.json> <report.md>\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
