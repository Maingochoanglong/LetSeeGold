import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, parseAmount } from '../site/convert.js';

const rates = {
  USD: { cash: 25660, transfer: 25690, sell: 26070 },
  JPY: { cash: 157.62, transfer: 159.21, sell: 168.47 },
  KRW: { cash: 16.69, transfer: 18.54, sell: 20.12 },
};

test('parseAmount understands Vietnamese and English number styles', () => {
  assert.equal(parseAmount('100'), 100);
  assert.equal(parseAmount('1.000.000'), 1_000_000);
  assert.equal(parseAmount('1,000,000'), 1_000_000);
  assert.equal(parseAmount('1.500'), 1500);
  assert.equal(parseAmount('2,5'), 2.5);
  assert.equal(parseAmount('2.75'), 2.75);
  assert.equal(parseAmount('0.500'), 0.5);
  assert.equal(parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(parseAmount('1,234,567.89'), 1234567.89);
  assert.equal(parseAmount(' 50 000 ₫'), 50000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
});

test('foreign -> VND uses the bank buy (transfer) rate', () => {
  const r = convert(100, 'USD', 'VND', rates);
  assert.equal(r.value, 2_569_000);
  assert.deepEqual(r.legs, [{ code: 'USD', rate: 25690, side: 'buy' }]);
});

test('VND -> foreign uses the bank sell rate', () => {
  const r = convert(1_000_000, 'VND', 'KRW', rates);
  assert.equal(r.value, 1_000_000 / 20.12);
  assert.deepEqual(r.legs, [{ code: 'KRW', rate: 20.12, side: 'sell' }]);
});

test('cross rates go through VND', () => {
  const r = convert(10_000, 'JPY', 'KRW', rates);
  assert.equal(r.value, (10_000 * 159.21) / 20.12);
  assert.equal(r.legs.length, 2);
});

test('same currency and missing rates', () => {
  assert.deepEqual(convert(5, 'USD', 'USD', rates), { value: 5, legs: [] });
  assert.deepEqual(convert(5, 'VND', 'VND', rates), { value: 5, legs: [] });
  assert.equal(convert(5, 'EUR', 'VND', rates), null);
  assert.equal(convert(5, 'VND', 'USD', {}), null);
});
