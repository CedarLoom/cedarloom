import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askUntil, queueArgs } from '../hooks/ask/window.mjs';

const NOW = 1_000_000_000_000;

test('askUntil: reads a span in minutes or hours', () => {
  for (const [args, minutes] of [
    ['', 30],
    ['45', 45],
    [' 45 ', 45],
    ['9999', 9999],
    ['45m', 45],
    ['45 m', 45],
    ['45M', 45],
    ['2h', 120],
    ['2 h', 120],
    ['for 45', 45],
    ['for 45m', 45],
    ['for 45 m', 45],
    ['for 2h', 120],
    ['For 2 H', 120],
  ]) assert.equal(askUntil(args, NOW), NOW + minutes * 60_000, args);
  assert.equal(askUntil('off', NOW), null);
});

test('askUntil: leaves every other text unread', () => {
  for (const args of ['0', '0m', '0h', 'for 0', 'for 0m', '00', '10000', '10000m', '-5', '1.5h', '45s', '45 min', '45mm', 'for', 'for m', 'for45', '45 for', 'm45']) {
    assert.equal(askUntil(args, NOW), undefined, args);
  }
});

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
