import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awayUntil } from '../hooks/ask/window.mjs';

const NOW = 1_000_000_000_000;

test('awayUntil: reads no span as until off, and a span in minutes or hours', () => {
  assert.equal(awayUntil('', NOW), Infinity);
  assert.equal(awayUntil(' ', NOW), Infinity);
  for (const [args, minutes] of [
    ['30', 30],
    [' 30 ', 30],
    ['9999', 9999],
    ['30m', 30],
    ['30 m', 30],
    ['30M', 30],
    ['2h', 120],
    ['2 h', 120],
    ['2H', 120],
  ]) assert.equal(awayUntil(args, NOW), NOW + minutes * 60_000, args);
  assert.equal(awayUntil('off', NOW), null);
  assert.equal(awayUntil('OFF', NOW), null);
});

test('awayUntil: reads until HH:MM as the next such local time', () => {
  const now = new Date(2026, 0, 15, 8, 0).getTime();
  assert.equal(awayUntil('until 09:15', now), new Date(2026, 0, 15, 9, 15).getTime());
  assert.equal(awayUntil('until 7:30', now), new Date(2026, 0, 16, 7, 30).getTime());
  assert.equal(awayUntil('until 08:00', now), new Date(2026, 0, 16, 8, 0).getTime());
});

test('awayUntil: leaves every other text unread', () => {
  for (const args of ['0', '0m', '0h', '00', '10000', '10000m', '-5', '1.5h', '45s', '45 min', '45mm', 'for 45', 'm45', 'until', 'until 24:00', 'until 7:5', 'until 7', 'offf', 'off 2h']) {
    assert.equal(awayUntil(args, NOW), undefined, args);
  }
});
