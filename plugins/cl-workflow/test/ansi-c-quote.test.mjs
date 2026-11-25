import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ansiC } from '../hooks/ansi-c-quote.mjs';

const raw = String.raw;
// The bytes of $'<body>' as hex.
const hex = (body, mode) => Buffer.from(ansiC(`${body}'`, 0, mode).value).toString('hex');

test('ansiC: bash 3.2 reads \\c with one following character', () => {
  // Bytes /bin/bash 3.2.57 prints for printf '%s' $'<body>'.
  const bash3 = {
    [raw`\c\\x3b`]: '1c3b',
    [raw`\c\\073`]: '1c3b',
    [raw`\c\\n`]: '1c0a',
    [raw`\c\\x67h`]: '1c6768',
    [raw`\c\\\\x3b`]: '1c5c3b',
    [raw`\c\\\x3b`]: '1c5c783362',
    [raw`\c\'x3b`]: '1c27783362',
    [raw`\c"x3b`]: '02783362',
    [raw`\c$x3b`]: '04783362',
  };
  for (const [body, bytes] of Object.entries(bash3)) assert.equal(hex(body, 'bash3'), bytes, body);
});

test('ansiC: the copy in each plugin is the same file', () => {
  // The plugins folder of the repository; an installed plugin holds its own folder alone and runs no tests.
  const plugins = join(fileURLToPath(new URL('..', import.meta.url)), '..');
  const copy = (plugin) => readFileSync(join(plugins, plugin, 'hooks', 'ansi-c-quote.mjs'), 'utf8');
  assert.equal(copy('cl-workflow'), copy('cl-orchestration'));
});
