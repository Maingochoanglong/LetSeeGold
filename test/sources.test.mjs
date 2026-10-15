import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeTurboStream,
  parseBtmh,
  parseNgocTham,
  parseGiavangOrg,
  parseVnexpressSjc,
  parseMihong,
  parseNum,
  parsePhuquy,
  parsePnj,
  vnDate,
  vnDateTime,
} from '../site/sources.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));
const byKey = (items, key) => items.find((i) => i.key === key);

test('parseNum handles both separators', () => {
  assert.equal(parseNum('25,660.00'), 25660);
  assert.equal(parseNum('14,100,000'), 14100000);
  assert.equal(parseNum('141.800', ','), 141800);
  assert.equal(parseNum('99,99', ','), 99.99);
  assert.equal(parseNum(14180), 14180);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('-'), null);
  assert.equal(parseNum('abc'), null);
});

test('date helpers use Vietnam time', () => {
  assert.equal(vnDateTime('10/10/2026 10:08:48'), '2026-10-10T03:08:48.000Z');
  assert.equal(vnDateTime('Cập nhật lúc 16:23 10/10/2026'), '2026-10-10T09:23:00.000Z');
  assert.equal(vnDateTime('11/10/2026 06:55'), '2026-10-10T23:55:00.000Z');
  assert.equal(vnDateTime('không có'), null);
  assert.equal(vnDate('2026-10-10T17:30:00Z'), '2026-10-11');
  assert.equal(vnDate('2026-10-10T16:59:00Z'), '2026-10-10');
});

test('PNJ: thousand VND per chỉ -> VND per lượng', () => {
  const { items, sourceTime } = parsePnj(json('pnj.json'));
  assert.equal(sourceTime, '2026-10-10T03:08:48.000Z');
  const sjc = byKey(items, 'pnj:SJC');
  assert.equal(sjc.name, 'Vàng miếng SJC 999.9');
  assert.equal(sjc.buy, 141_800_000);
  assert.equal(sjc.sell, 144_800_000);
  const raw = byKey(items, 'pnj:RAW_9999');
  assert.equal(raw.sell, null);
  assert.equal(raw.buy, 132_250_000);
  assert.equal(items.length, 20);
});

test('Mi Hồng: VND per chỉ -> VND per lượng', () => {
  const { items, sourceTime } = parseMihong(json('mihong.json'));
  assert.equal(sourceTime, '2026-10-10T23:55:00.000Z');
  const sjc = byKey(items, 'mihong:SJC');
  assert.equal(sjc.name, 'Vàng miếng SJC');
  assert.equal(sjc.buy, 142_000_000);
  assert.equal(sjc.sell, 143_500_000);
  assert.equal(byKey(items, 'mihong:950').sell, null);
  assert.equal(items.length, 10);
});

test('Phú Quý: HTML table, skips silver', () => {
  const { items, sourceTime } = parsePhuquy(fixture('phuquy.html'));
  assert.equal(sourceTime, '2026-10-10T09:23:00.000Z');
  assert.equal(items.length, 10);
  assert.ok(items.every((i) => !/bạc/i.test(i.name)));
  assert.deepEqual(
    { name: items[0].name, buy: items[0].buy, sell: items[0].sell },
    { name: 'Vàng miếng SJC', buy: 141_000_000, sell: 144_800_000 },
  );
  assert.equal(items[1].name, 'Nhẫn tròn Phú Quý 999.9');
  assert.equal(items.at(-1).sell, null);
});

test('parsers reject empty or foreign payloads', () => {
  assert.throws(() => parsePnj({ errors: {} }));
  assert.throws(() => parseMihong([]));
  assert.throws(() => parsePhuquy('<html>Sorry, you have been blocked</html>'));
});

test('giavang.org SJC: first region only, thousand VND per lượng', () => {
  const r = parseGiavangOrg(fixture('giavang-sjc.html'), 'sjc');
  assert.equal(r.region, 'Hồ Chí Minh');
  assert.equal(r.via, 'giavang.org');
  assert.equal(r.sourceTime, '2026-10-11T05:05:04.000Z');
  assert.equal(r.items.length, 12);
  assert.deepEqual(
    { name: r.items[0].name, buy: r.items[0].buy, sell: r.items[0].sell },
    { name: 'Vàng SJC 1L, 10L, 1KG', buy: 141_800_000, sell: 144_800_000 },
  );
  assert.equal(r.items[3].name, 'Vàng nhẫn SJC 99,99% 1 chỉ, 2 chỉ, 5 chỉ');
  assert.equal(r.items.at(-1).buy, 50_112_000);
});

test('giavang.org DOJI: drops silver and other regions', () => {
  // Fixture trimmed from a real page; the second region was cut short.
  const r = parseGiavangOrg(fixture('giavang-doji.html'), 'doji');
  assert.equal(r.region, 'Hà Nội');
  assert.deepEqual(
    r.items.map((i) => i.name),
    ['SJC Lẻ', 'AVPL', 'Nhẫn tròn 999 Hưng Thịnh Vượng', 'Nguyên liệu 99.99', 'Nguyên liệu 99.9', 'Nữ trang 99.99', 'Nữ trang 99.9', 'Nữ trang 99'],
  );
  assert.equal(r.items[1].sell, 144_300_000);
});

test('giavang.org BTMC: all product lines, prefixed', () => {
  const r = parseGiavangOrg(fixture('giavang-btmc.html'), 'btmc', { groups: 'all' });
  assert.equal(r.region, null);
  const names = r.items.map((i) => i.name);
  assert.equal(names[0], 'VRTL – Vàng miếng 999.9 (24k)');
  assert.ok(!names.some((n) => /xu/i.test(n)), 'per-piece coins are skipped');
  assert.ok(names.includes('Vàng SJC – Vàng miếng 999.9 (24k)'));
  assert.ok(names.includes('Vàng BTMC – Trang sức bằng Vàng Rồng Thăng Long 999.9 (24k)'));
  const gift = r.items.find((i) => i.name.startsWith('Quà Mừng Vàng'));
  assert.equal(gift.sell, null);
  assert.equal(gift.buy, 133_100_000);
});

test('VnExpress SJC fallback', () => {
  const r = parseVnexpressSjc(json('vnexpress.json'));
  assert.equal(r.sourceTime, '2026-10-11T05:05:36.809Z');
  assert.equal(r.items.length, 5);
  assert.equal(r.items[0].name, 'Vàng SJC 1L, 10L, 1KG');
  assert.equal(r.items[0].buy, 141_800_000);
  assert.equal(r.items[0].sell, 144_800_000);
  assert.throws(() => parseVnexpressSjc({ data: {} }));
});

test('turbo-stream decoding: shared values and special indexes', () => {
  const text = JSON.stringify([{ _1: 2, _3: 4 }, 'a', 'shared', 'b', [2, 2, -5, 5], 7]);
  assert.deepEqual(decodeTurboStream(text), { a: 'shared', b: ['shared', 'shared', null, 7] });
});

test('Bảo Tín Mạnh Hải: route data, per-row units, no silver', () => {
  const { items, sourceTime } = parseBtmh(fixture('btmh.data'));
  assert.equal(sourceTime, '2026-10-09T10:49:21.000Z');
  assert.ok(items.every((i) => !/bạc|ngân gia bảo/i.test(i.name)), 'silver rows are skipped');
  const sjc = byKey(items, 'btmh:SJC9999');
  assert.equal(sjc.name, 'Vàng miếng SJC (Cty CP BTMH)');
  assert.equal(sjc.buy, 141_800_000);
  assert.equal(sjc.sell, 144_800_000);
  // Priced per 0,1 chỉ on the site.
  assert.equal(byKey(items, 'btmh:BT-TKC').buy, 139_800_000);
  // The site writes 1 in the sell column of buy-only rows.
  assert.equal(byKey(items, 'btmh:NL9999').sell, null);
  assert.equal(items.length, 9);
});

test('Ngọc Thẩm: price table, VND per chỉ', () => {
  const { items, sourceTime } = parseNgocTham(fixture('ngoctham.html'));
  assert.equal(sourceTime, '2026-10-11T00:30:00.000Z');
  assert.equal(items.length, 6);
  const sjc = items.find((i) => /SJC/.test(i.name));
  assert.deepEqual({ name: sjc.name, buy: sjc.buy, sell: sjc.sell }, { name: 'Vàng Miếng SJC (Loại 10 chỉ)', buy: 140_000_000, sell: 143_500_000 });
  assert.equal(items[0].name, 'Nhẫn Trơn 24K');
  assert.throws(() => parseNgocTham('<html>Bảo trì</html>'));
});
