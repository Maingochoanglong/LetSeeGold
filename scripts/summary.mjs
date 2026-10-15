// Prints a Markdown summary of a built snapshot (used in the CI job summary).
//   node scripts/summary.mjs dist/data/latest.json

import { readFileSync } from 'node:fs';
import { SHOPS } from '../site/sources.js';

const snap = JSON.parse(readFileSync(process.argv[2] || 'dist/data/latest.json', 'utf8'));
const fmt = (v) => (v == null ? '—' : new Intl.NumberFormat('vi-VN').format(v));
const lines = ['## Dữ liệu lấy được', '', '| Nguồn | Trạng thái | Số dòng | Dòng đầu (mua / bán, đ/lượng) |', '|---|---|---|---|'];
for (const shop of SHOPS) {
  const s = snap.gold[shop.id];
  const first = s?.ok ? s.items[0] : null;
  const status = !s ? 'không có' : !s.ok ? `❌ ${s.error}` : s.stale ? `⚠️ dữ liệu cũ (${s.error})` : `✅ ${s.via || 'chính chủ'}`;
  lines.push(`| ${shop.name} | ${status} | ${s?.ok ? s.items.length : 0} | ${first ? `${first.name}: ${fmt(first.buy)} / ${fmt(first.sell)}` : ''} |`);
}
console.log(lines.join('\n'));
