import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withBlock } from './token-budget-block.mjs';

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
