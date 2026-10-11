import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseErApi,
  parseGiavangOrg,
  parseVnexpressSjc,
  parseMihong,
  parseNum,
  parsePhuquy,
  parsePnj,
  parseSjc,
  parseVcbJson,
  parseVcbXml,
  parseWorldGold,
  usDateTime,
  vnDate,
  vnDateTime,
  worldToVndPerLuong,
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
  assert.equal(usDateTime('10/11/2026 11:57:36 AM'), '2026-10-11T04:57:36.000Z');
  assert.equal(usDateTime('10/11/2026 1:05:00 PM'), '2026-10-11T06:05:00.000Z');
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

test('Vietcombank XML and JSON agree', () => {
  const xml = parseVcbXml(fixture('vcb.xml'));
  const js = parseVcbJson(json('vcb.json'));
  assert.deepEqual(Object.keys(xml.rates), ['USD', 'JPY', 'KRW']);
  assert.deepEqual(xml.rates.USD, { cash: 25660, transfer: 25690, sell: 26070 });
  assert.deepEqual(xml.rates.JPY, { cash: 157.62, transfer: 159.21, sell: 168.47 });
  assert.deepEqual(xml.rates.KRW, { cash: 16.69, transfer: 18.54, sell: 20.12 });
  assert.deepEqual(js.rates, xml.rates);
  assert.equal(xml.sourceTime, '2026-10-11T04:57:36.000Z');
  assert.equal(js.sourceTime, '2026-10-10T16:00:00.000Z');
});

test('open.er-api fallback gives mid rates in VND', () => {
  const { rates } = parseErApi(json('er-api.json'));
  assert.equal(rates.USD.transfer, 26214);
  assert.equal(rates.USD.cash, null);
  assert.equal(rates.JPY.sell, Math.round((26214 / 161.19) * 100) / 100);
});

test('world gold conversion', () => {
  const { usdPerOunce } = parseWorldGold(json('gold-api.json'));
  assert.equal(usdPerOunce, 4195.6);
  // 1 lượng = 37.5 g = 1.20565 oz
  assert.equal(worldToVndPerLuong(4195.6, 26070), Math.round(((4195.6 * 37.5) / 31.1034768) * 26070));
});

test('parsers reject empty or foreign payloads', () => {
  assert.throws(() => parsePnj({ errors: {} }));
  assert.throws(() => parseMihong([]));
  assert.throws(() => parsePhuquy('<html>Sorry, you have been blocked</html>'));
  assert.throws(() => parseVcbXml('<html></html>'));
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

test('sjc.com.vn: first branch, VND per lượng', () => {
  // Built from the price service's field names: sjc.com.vn refuses requests
  // from outside Vietnam, so no live response could be captured for it.
  const r = parseSjc(json('sjc.json'));
  assert.equal(r.via, 'sjc.com.vn');
  assert.equal(r.region, 'Hồ Chí Minh');
  assert.equal(r.sourceTime, '2026-10-11T03:18:00.000Z');
  assert.equal(r.items.length, 3);
  assert.deepEqual(
    { key: r.items[0].key, buy: r.items[0].buy, sell: r.items[0].sell },
    { key: 'sjc:vang-sjc-1l-10l-1kg', buy: 141_800_000, sell: 144_800_000 },
  );
  // Falls back to the thousand-VND text when the numeric value is missing.
  assert.equal(r.items[2].buy, 141_300_000);
  assert.equal(r.items[2].sell, 144_300_000);
  // Same keys as the giavang.org mirror, so ▲▼ keeps working when the source switches.
  const mirror = parseGiavangOrg(fixture('giavang-sjc.html'), 'sjc');
  assert.equal(mirror.items[0].key, r.items[0].key);
  assert.throws(() => parseSjc({ success: false }));
  assert.throws(() => parseSjc({ data: [] }));
});
