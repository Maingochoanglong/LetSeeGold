import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshot, pricesOf } from '../scripts/snapshot.mjs';

const ok = (fetchedAt, items) => ({ ok: true, fetchedAt, sourceTime: null, items });
const fail = (fetchedAt, error = 'HTTP 503') => ({ ok: false, fetchedAt, error });
const it = (key, buy, sell) => ({ key, name: key, buy, sell });

function snap(generatedAt, gold, extra = {}) {
  return { generatedAt, gold, fx: null, ...extra };
}

test('keeps the last good data of a failing source, marked stale', () => {
  const prev = snap('2026-10-11T03:00:00Z', { pnj: ok('2026-10-11T03:00:00Z', [it('pnj:SJC', 1, 2)]) });
  const fresh = snap('2026-10-11T03:10:00Z', { pnj: fail('2026-10-11T03:10:00Z') });
  const out = mergeSnapshot(fresh, prev, Date.parse('2026-10-11T03:10:00Z'));
  assert.equal(out.gold.pnj.ok, true);
  assert.equal(out.gold.pnj.stale, true);
  assert.equal(out.gold.pnj.error, 'HTTP 503');
  assert.equal(out.gold.pnj.fetchedAt, '2026-10-11T03:00:00Z');
  assert.deepEqual(out.gold.pnj.items, [it('pnj:SJC', 1, 2)]);
});

test('drops data that has been failing for too long', () => {
  const prev = snap('2026-10-11T03:00:00Z', { pnj: { ...ok('2026-10-07T03:00:00Z', [it('pnj:SJC', 1, 2)]), stale: true } });
  const fresh = snap('2026-10-11T03:10:00Z', { pnj: fail('2026-10-11T03:10:00Z') });
  const out = mergeSnapshot(fresh, prev, Date.parse('2026-10-11T03:10:00Z'));
  assert.equal(out.gold.pnj.ok, false);
});

test('fresh data replaces stale data', () => {
  const prev = snap('2026-10-11T03:00:00Z', { pnj: { ...ok('2026-10-11T02:00:00Z', [it('pnj:SJC', 1, 2)]), stale: true } });
  const fresh = snap('2026-10-11T03:10:00Z', { pnj: ok('2026-10-11T03:10:00Z', [it('pnj:SJC', 3, 4)]) });
  const out = mergeSnapshot(fresh, prev, Date.parse('2026-10-11T03:10:00Z'));
  assert.equal(out.gold.pnj.stale, undefined);
  assert.equal(out.gold.pnj.items[0].buy, 3);
});

test('reference prices roll over at midnight Vietnam time', () => {
  const day1 = snap('2026-10-10T16:50:00Z', { pnj: ok('2026-10-10T16:50:00Z', [it('pnj:SJC', 100, 110)]) }, {
    fx: { ok: true, fetchedAt: '2026-10-10T16:50:00Z', rates: { USD: { cash: 1, transfer: 25000, sell: 25300 } } },
  });
  // 23:50 -> 00:05 (UTC+7): the last snapshot of the 10th becomes the reference.
  const first = mergeSnapshot(snap('2026-10-10T17:05:00Z', { pnj: ok('2026-10-10T17:05:00Z', [it('pnj:SJC', 105, 115)]) }), day1);
  assert.deepEqual(first.ref, {
    date: '2026-10-10',
    prices: { 'pnj:SJC': [100, 110], 'fx:USD': [25000, 25300] },
  });
  // Later the same day the reference is carried over unchanged.
  const second = mergeSnapshot(snap('2026-10-11T05:00:00Z', { pnj: ok('2026-10-11T05:00:00Z', [it('pnj:SJC', 120, 130)]) }), first);
  assert.deepEqual(second.ref, first.ref);
});

test('no reference without history', () => {
  const out = mergeSnapshot(snap('2026-10-11T05:00:00Z', { pnj: ok('2026-10-11T05:00:00Z', [it('pnj:SJC', 1, 2)]) }), null);
  assert.equal(out.ref, null);
  assert.equal(out.version, 1);
});

test('pricesOf flattens gold and fx', () => {
  const p = pricesOf({
    gold: { a: ok('x', [it('a:1', 1, 2)]), b: fail('x') },
    fx: { ok: true, rates: { JPY: { cash: 1, transfer: 2, sell: 3 } } },
  });
  assert.deepEqual(p, { 'a:1': [1, 2], 'fx:JPY': [2, 3] });
});
