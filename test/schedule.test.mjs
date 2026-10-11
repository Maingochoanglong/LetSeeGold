import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRun, nextRun, normalizeTimes } from '../site/schedule.js';

// Local-time helpers so the tests do not depend on the machine's time zone.
const d = (day, h, m) => new Date(2026, 9, day, h, m, 0, 0);
const same = (a, b) => assert.equal(a?.getTime(), b?.getTime());

test('fixed times: next one today, then tomorrow', () => {
  const s = { mode: 'times', times: ['17:00', '08:30', '11:30', 'bad', '08:30'] };
  same(nextRun(s, d(11, 7, 0)), d(11, 8, 30));
  same(nextRun(s, d(11, 8, 30)), d(11, 11, 30)); // strictly after now
  same(nextRun(s, d(11, 12, 0)), d(11, 17, 0));
  same(nextRun(s, d(11, 18, 0)), d(12, 8, 30));
  assert.equal(nextRun({ mode: 'times', times: [] }, d(11, 8, 0)), null);
});

test('interval inside a window, aligned to the window start', () => {
  const s = { mode: 'interval', every: 15, from: '08:00', to: '18:00' };
  same(nextRun(s, d(11, 6, 0)), d(11, 8, 0));
  same(nextRun(s, d(11, 8, 0)), d(11, 8, 15));
  same(nextRun(s, d(11, 9, 7)), d(11, 9, 15));
  same(nextRun(s, d(11, 17, 50)), d(11, 18, 0));
  same(nextRun(s, d(11, 18, 0)), d(12, 8, 0));
});

test('interval window crossing midnight', () => {
  const s = { mode: 'interval', every: 60, from: '22:00', to: '02:00' };
  same(nextRun(s, d(11, 23, 30)), d(12, 0, 0));
  same(nextRun(s, d(12, 1, 10)), d(12, 2, 0));
  same(nextRun(s, d(12, 2, 0)), d(12, 22, 0));
});

test('manual and invalid schedules never run', () => {
  assert.equal(nextRun({ mode: 'manual' }, d(11, 8, 0)), null);
  assert.equal(nextRun({ mode: 'interval', every: 15, from: 'x', to: '18:00' }, d(11, 8, 0)), null);
  assert.equal(nextRun(null), null);
});

test('normalizeTimes and describeRun', () => {
  assert.deepEqual(normalizeTimes(['14:00', '08:05', '14:00', '24:00', 7]), ['08:05', '14:00']);
  assert.equal(describeRun(d(11, 14, 30), d(11, 9, 0)), '14:30 hôm nay');
  assert.equal(describeRun(d(12, 8, 5), d(11, 23, 0)), '08:05 ngày mai');
  assert.equal(describeRun(d(13, 8, 5), d(11, 23, 0)), '08:05 13/10');
});
