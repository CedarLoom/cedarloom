import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queueArgs } from '../hooks/ask/window.mjs';

test('queueArgs: reads a count and a filter', () => {
  for (const [args, expected] of [
    ['', { count: 'all', filter: null }],
    ['5', { count: 5, filter: null }],
    ['999', { count: 999, filter: null }],
    ['all', { count: 'all', filter: null }],
    ['ALL', { count: 'all', filter: null }],
    ['deferred', { count: 'all', filter: 'deferred' }],
    ['Deferred', { count: 'all', filter: 'deferred' }],
    ['foo', { count: 'all', filter: { project: 'foo' } }],
    ['5 deferred', { count: 5, filter: 'deferred' }],
    ['5 foo', { count: 5, filter: { project: 'foo' } }],
    ['5 Foo', { count: 5, filter: { project: 'Foo' } }],
    ['all 7', { count: 'all', filter: { project: '7' } }],
    ['all all', { count: 'all', filter: { project: 'all' } }],
    ['.github', { count: 'all', filter: { project: '.github' } }],
    ['5 _site', { count: 5, filter: { project: '_site' } }],
  ]) assert.deepEqual(queueArgs(args), expected, args);
});

test('queueArgs: leaves every other text unread', () => {
  for (const args of ['0', '1000', '007', '0 foo', '5 6 7', 'foo bar', '-1', 'deferred 5', 'foo deferred', 'owner/repo']) {
    assert.equal(queueArgs(args), undefined, args);
  }
});
