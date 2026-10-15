// Data sources for gold prices and exchange rates.
//
// This module is shared by the scheduled build (Node, scripts/build.mjs) and by
// the web page (browser, app.js). Every parser is a pure function so it can be
// unit-tested against saved responses in test/fixtures.
//
// All gold prices are normalised to VND per lượng (1 lượng = 10 chỉ = 37.5 g).

export const CHI_PER_LUONG = 10;

// Shops whose own websites can be read come first; the last three are read
// from the giavang.org mirror because their sites refuse servers abroad.
export const SHOPS = [
  {
    id: 'pnj',
    name: 'PNJ',
    fullName: 'Vàng bạc Đá quý Phú Nhuận',
    website: 'https://www.pnj.com.vn/site/gia-vang',
  },
  {
    id: 'mihong',
    name: 'Mi Hồng',
    fullName: 'Tiệm vàng Mi Hồng (TP.HCM)',
    website: 'https://www.mihong.vn/vi/gia-vang-trong-nuoc',
  },
  {
    id: 'btmh',
    name: 'Bảo Tín Mạnh Hải',
    fullName: 'Công ty cổ phần Bảo Tín Mạnh Hải (Hà Nội)',
    website: 'https://baotinmanhhai.vn/bang-gia-vang',
  },
  {
    id: 'phuquy',
    name: 'Phú Quý',
    fullName: 'Tập đoàn Vàng bạc Đá quý Phú Quý',
    website: 'https://phuquygroup.vn',
  },
  {
    id: 'ngoctham',
    name: 'Ngọc Thẩm',
    fullName: 'Trang sức Ngọc Thẩm (TP.HCM)',
    website: 'https://ngoctham.com/bang-gia-vang/',
  },
  {
    id: 'doji',
    name: 'DOJI',
    fullName: 'Tập đoàn Vàng bạc Đá quý DOJI',
    website: 'https://giavang.doji.vn',
  },
  {
    id: 'btmc',
    name: 'Bảo Tín Minh Châu',
    fullName: 'Vàng bạc Đá quý Bảo Tín Minh Châu',
    website: 'https://btmc.vn',
  },
  {
    id: 'sjc',
    name: 'SJC',
    fullName: 'Công ty Vàng bạc Đá quý Sài Gòn',
    website: 'https://sjc.com.vn',
  },
];

export const URLS = {
  pnj: 'https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price?zone=00',
  mihong: 'https://api.mihong.vn/v1/gold-prices?market=domestic',
  phuquy: 'https://phuquygroup.vn/',
  btmh: 'https://baotinmanhhai.vn/bang-gia-vang.data',
  ngoctham: 'https://ngoctham.com/bang-gia-vang/',
  vnexpress: 'https://gw.vnexpress.net/cr/?name=tygia_vangv202206',
  giavangOrg: (page) => `https://giavang.org/trong-nuoc/${page}/`,
};

// ---------------------------------------------------------------------------
// Helpers

const pad = (n) => String(n).padStart(2, '0');

/**
 * Parses a number written by a Vietnamese source.
 * `decimal` is the decimal separator used by that source; the other one of
 * "," / "." is treated as a thousands separator.
 */
export function parseNum(value, decimal = '.') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let s = value.replace(/[\s ₫đ]/g, '');
  if (!s || s === '-' || s === '--') return null;
  const thousands = decimal === '.' ? ',' : '.';
  s = s.split(thousands).join('');
  if (decimal === ',') s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * A price that is missing or implausibly small means "not traded" (some shops
 * write 0 or 1 in the column they do not quote).
 */
function price(value) {
  return value != null && Number.isFinite(value) && value >= 1000 ? Math.round(value) : null;
}

/**
 * Vietnam-time "dd/mm/yyyy" plus an optional "HH:MM[:SS]" before or after it
 * ("10/10/2026 10:08:48", "16:23 10/10/2026") -> ISO string.
 */
export function vnDateTime(str) {
  const date = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str || '');
  if (!date) return null;
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(str.replace(date[0], ' ')) || [];
  const [, d, mo, y] = date;
  const [, h = '0', mi = '0', s = '0'] = time;
  const t = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+07:00`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Calendar date (YYYY-MM-DD) in Vietnam for an instant. */
export function vnDate(date = new Date()) {
  const t = new Date(new Date(date).getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

function slug(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function cleanText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function item(shop, code, name, buy, sell, extra = {}) {
  return { key: `${shop}:${code || slug(name)}`, name: name.trim(), buy: price(buy), sell: price(sell), ...extra };
}

function ensureItems(items, what) {
  const valid = items.filter((i) => i.buy != null || i.sell != null);
  if (!valid.length) throw new Error(`Không đọc được giá từ ${what}`);
  return valid;
}

// ---------------------------------------------------------------------------
// Parsers (pure)

/** PNJ: JSON, prices in thousand VND per chỉ. */
export function parsePnj(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  const toLuong = (v) => {
    const n = parseNum(v);
    return n == null ? null : n * 1000 * CHI_PER_LUONG;
  };
  const items = rows.map((r) =>
    item('pnj', r.masp, String(r.tensp || r.masp || ''), toLuong(r.giamua), toLuong(r.giaban), r.note ? { note: r.note } : {}),
  );
  return {
    items: ensureItems(items, 'PNJ'),
    sourceTime: vnDateTime(json?.updateDate),
    note: json?.note || null,
  };
}

const MIHONG_NAMES = {
  SJC: 'Vàng miếng SJC',
  999: 'Vàng 999 (24K)',
  985: 'Vàng 985',
  980: 'Vàng 980',
  950: 'Vàng 950',
  750: 'Vàng 750 (18K)',
  680: 'Vàng 680 (16K)',
  610: 'Vàng 610 (14.6K)',
  580: 'Vàng 580 (14K)',
  410: 'Vàng 410 (10K)',
};

/** Mi Hồng: JSON array, prices in VND per chỉ. */
export function parseMihong(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const toLuong = (v) => {
    const n = parseNum(v);
    return n == null ? null : n * CHI_PER_LUONG;
  };
  const items = rows.map((r) => {
    const code = String(r.code ?? '').trim();
    return item('mihong', code, MIHONG_NAMES[code] || `Vàng ${code}`, toLuong(r.buyingPrice), toLuong(r.sellingPrice));
  });
  const times = rows.map((r) => vnDateTime(r.dateTime)).filter(Boolean).sort();
  return { items: ensureItems(items, 'Mi Hồng'), sourceTime: times.at(-1) || null };
}

/**
 * Decodes a React Router "turbo-stream" payload: a flat JSON array where
 * objects are {"_<key index>": <value index>} and arrays hold value indexes,
 * so repeated values are stored once. Negative indexes are special values.
 */
export function decodeTurboStream(text) {
  const values = JSON.parse(text);
  if (!Array.isArray(values)) throw new Error('Không phải turbo-stream');
  const special = { '-5': null, '-7': undefined, '-1': undefined, '-2': NaN };
  const done = new Map();
  const hydrate = (i) => {
    if (i < 0) return special[i];
    if (done.has(i)) return done.get(i);
    const v = values[i];
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') return v[0] === 'D' ? new Date(v[1]).toISOString() : null; // typed values
      const out = [];
      done.set(i, out);
      for (const x of v) out.push(hydrate(x));
      return out;
    }
    const out = {};
    done.set(i, out);
    for (const [k, x] of Object.entries(v)) out[values[Number(k.slice(1))]] = hydrate(x);
    return out;
  };
  return hydrate(0);
}

/**
 * Bảo Tín Mạnh Hải: the price page's route data (turbo-stream). Rows carry
 * their own unit ("VND/1 chỉ", "VND/0,1 chỉ", "VND/1 lượng").
 */
export function parseBtmh(text) {
  const root = decodeTurboStream(text);
  const blocks = Object.values(root || {}).flatMap((route) => route?.data?.blocks || []);
  const seen = new Set();
  const items = [];
  const times = [];
  for (const block of blocks) {
    if (block?.block_type !== 'gold_price_table') continue;
    for (const r of block.data?._gold_rates?.items || []) {
      if (!r?.code || seen.has(r.code)) continue;
      seen.add(r.code);
      if (/BAC/i.test(r.code) || /bạc/i.test(r.name || '')) continue; // silver
      const unit = /VND\/\s*([\d.,]*)\s*(chỉ|lượng)?/i.exec(r.unit || '');
      const qty = (unit && parseNum(unit[1], ',')) || 1;
      const perLuong = (unit && /lượng/i.test(unit[2] || '') ? 1 : CHI_PER_LUONG) / qty;
      const b = parseNum(r.buy_price);
      const s = parseNum(r.sell_price);
      items.push(item('btmh', r.code, String(r.name || r.code), b && b * perLuong, s && s * perLuong));
      const t = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(r.last_updated || '');
      if (t) times.push(`${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:${t[6]}+07:00`);
    }
  }
  const latest = times.sort().at(-1);
  return { items: ensureItems(items, 'Bảo Tín Mạnh Hải'), sourceTime: latest ? new Date(latest).toISOString() : null };
}

/** Ngọc Thẩm: price table on the website, VND per chỉ. */
export function parseNgocTham(html) {
  const unit = /ĐƠN VỊ TÍNH[\s\S]{0,80}?VND\s*\/\s*(Chỉ|Lượng)/i.exec(html);
  const factor = unit && /lượng/i.test(unit[1]) ? 1 : CHI_PER_LUONG;
  const items = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const name = /class="name-gold"[^>]*>([\s\S]*?)<\/td>/i.exec(tr);
    if (!name) continue;
    const buy = parseNum(cleanText(/class="price-buy"[^>]*>([\s\S]*?)<\/td>/i.exec(tr)?.[1] || ''), ',');
    const sell = parseNum(cleanText(/class="price-sell"[^>]*>([\s\S]*?)<\/td>/i.exec(tr)?.[1] || ''), ',');
    items.push(item('ngoctham', null, cleanText(name[1]), buy && buy * factor, sell && sell * factor));
  }
  // "Cập nhật ngày 11/10/2026 07:30 AM"
  const t = /Cập nhật ngày[\s\S]{0,60}?(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(decodeEntities(html));
  let sourceTime = null;
  if (t) {
    let h = Number(t[2]);
    if (t[4]?.toUpperCase() === 'PM' && h < 12) h += 12;
    if (t[4]?.toUpperCase() === 'AM' && h === 12) h = 0;
    sourceTime = vnDateTime(`${t[1]} ${h}:${t[3]}`);
  }
  return { items: ensureItems(items, 'Ngọc Thẩm'), sourceTime };
}

/** Rows of the first `<table>` after `from` as arrays of cell text. */
function tableRows(html, from = 0) {
  const start = html.indexOf('<table', from);
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const rows = [];
  for (const tr of table.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cleanText(c[1]));
    rows.push(cells);
  }
  return rows;
}

/** Phú Quý: HTML table on the home page, prices in VND per chỉ. */
export function parsePhuquy(html) {
  const head = /Mua vào[\s\S]{0,200}?\(VNĐ\/(Chỉ|Lượng)\)/i.exec(html);
  const factor = head && /lượng/i.test(head[1]) ? 1 : CHI_PER_LUONG;
  const items = [];
  for (const cells of tableRows(html, html.indexOf('priceList'))) {
    if (cells.length < 3) continue;
    const [name, buy, sell] = cells;
    // The board also lists silver; this site is about gold.
    if (/bạc/i.test(name) && !/vàng/i.test(name)) continue;
    const b = parseNum(buy);
    const s = parseNum(sell);
    if (b == null && s == null) continue;
    items.push(item('phuquy', null, name, b && b * factor, s && s * factor));
  }
  const updated = /cập nhật lần cuối[^<]*/i.exec(decodeEntities(html))?.[0];
  return { items: ensureItems(items, 'Phú Quý'), sourceTime: vnDateTime(updated) };
}

/**
 * giavang.org mirrors the boards of shops whose own sites refuse requests
 * from servers abroad (SJC, DOJI, Bảo Tín Minh Châu).
 * Prices are in thousand VND per lượng. Rows are grouped by a `<th rowspan>`
 * cell: a region for SJC/DOJI (only the first region is kept) or a product
 * line for BTMC (all kept, used as a name prefix).
 */
export function parseGiavangOrg(html, shop, { groups = 'first' } = {}) {
  const unit = /Đơn vị:\s*x?\s*([\d.]+)\s*đ\s*\/\s*(lượng|chỉ)/i.exec(html);
  const factor = (unit ? parseNum(unit[1], ',') : 1000) * (unit && /chỉ/i.test(unit[2]) ? CHI_PER_LUONG : 1);
  const start = Math.max(0, html.indexOf('table-bordered'));
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);

  const items = [];
  let group = null;
  let firstGroup = null;
  for (const tr of table.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const th = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(tr);
    const tds = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cleanText(c[1]));
    if (th && tds.length) {
      group = cleanText(th[1]);
      firstGroup ??= group;
    }
    if (tds.length < 3) continue;
    if (groups === 'first' && group !== firstGroup) continue;
    const [name, buy, sell] = tds;
    if (/bạc/i.test(name) && !/vàng/i.test(name)) continue; // silver
    if (/\bxu\b.*\b0[.,]\d/i.test(name)) continue; // fractional coins are priced per piece
    const label = groups === 'all' && group && !name.toLowerCase().includes(group.toLowerCase()) ? `${group} – ${name}` : name;
    const b = parseNum(buy, ',');
    const s = parseNum(sell, ',');
    items.push(item(shop, null, label, b && b * factor, s && s * factor));
  }
  const updated = /Cập nhật lúc\s*([\d:]+\s+\d{1,2}\/\d{1,2}\/\d{4})/i.exec(html)?.[1];
  return {
    items: ensureItems(items, `giavang.org (${shop})`),
    sourceTime: vnDateTime(updated),
    region: groups === 'first' ? firstGroup : null,
    via: 'giavang.org',
  };
}

const VNEXPRESS_SJC = {
  sjc_1l_10l: 'Vàng SJC 1L, 10L, 1KG',
  sjc_5c: 'Vàng SJC 5 chỉ',
  sjc_2c_1c_5_phan: 'Vàng SJC 0.5 chỉ, 1 chỉ, 2 chỉ',
  'nu_trang_99.99percent': 'Nữ trang 99,99%',
  nu_trang_99percent: 'Nữ trang 99%',
};

/** VnExpress gold widget (JSON): SJC prices in thousand VND per lượng. */
export function parseVnexpressSjc(json) {
  const gold = json?.data?.data?.gold?.new || {};
  const items = Object.entries(VNEXPRESS_SJC)
    .filter(([key]) => gold[key])
    .map(([key, name]) => item('sjc', null, name, parseNum(gold[key].buy) * 1000, parseNum(gold[key].sell) * 1000));
  const t = json?.data?.updated_at ? new Date(json.data.updated_at) : null;
  return {
    items: ensureItems(items, 'VnExpress (SJC)'),
    sourceTime: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null,
    region: 'Hồ Chí Minh',
    via: 'VnExpress',
  };
}

// ---------------------------------------------------------------------------
// Fetching

const NODE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
};

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

async function get(url, { type = 'json', timeoutMs = 15000, init = {} } = {}) {
  // Browsers must not send custom headers here: that would trigger a CORS
  // preflight the sources do not answer.
  const headers = isBrowser ? init.headers : { ...NODE_HEADERS, ...(init.headers || {}) };
  let res;
  let text;
  try {
    res = await fetch(url, { cache: 'no-store', ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error('Hết thời gian chờ');
    if (e?.cause) throw new Error(`Không kết nối được (${e.cause.code || e.cause.message})`);
    throw e;
  }
  if (type !== 'json') return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Phản hồi không phải JSON');
  }
}

/** Tries each source in turn and returns the first that parses. */
async function firstOk(attempts) {
  const errors = [];
  for (const run of attempts) {
    try {
      return await run();
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(errors.join('; '));
}

export const GOLD_FETCHERS = {
  sjc: () =>
    firstOk([
      async () => parseGiavangOrg(await get(URLS.giavangOrg('sjc'), { type: 'text' }), 'sjc'),
      async () => parseVnexpressSjc(await get(URLS.vnexpress)),
    ]),
  pnj: async () => parsePnj(await get(URLS.pnj)),
  mihong: async () => parseMihong(await get(URLS.mihong)),
  doji: async () => parseGiavangOrg(await get(URLS.giavangOrg('doji'), { type: 'text' }), 'doji'),
  btmc: async () =>
    parseGiavangOrg(await get(URLS.giavangOrg('bao-tin-minh-chau'), { type: 'text' }), 'btmc', { groups: 'all' }),
  phuquy: async () => parsePhuquy(await get(URLS.phuquy, { type: 'text' })),
  btmh: async () => parseBtmh(await get(URLS.btmh, { type: 'text' })),
  ngoctham: async () => parseNgocTham(await get(URLS.ngoctham, { type: 'text' })),
};

/**
 * Shops the page also reads by itself at the user's scheduled times, straight
 * from the shop: their APIs allow cross-origin reads. The others come from
 * the scheduled build.
 */
export const BROWSER_FETCHERS = {
  pnj: GOLD_FETCHERS.pnj,
  mihong: GOLD_FETCHERS.mihong,
};

/** Runs a fetcher and turns the outcome into a serialisable status object. */
export async function settle(run) {
  const fetchedAt = new Date().toISOString();
  try {
    return { ok: true, fetchedAt, ...(await run()) };
  } catch (e) {
    return { ok: false, fetchedAt, error: String(e?.message || e) };
  }
}

/** Fetches every shop in `fetchers`. */
export async function collectAll({ fetchers = GOLD_FETCHERS } = {}) {
  const ids = SHOPS.map((s) => s.id).filter((id) => fetchers[id]);
  const results = await Promise.all(ids.map((id) => settle(fetchers[id])));
  const gold = {};
  ids.forEach((id, i) => {
    gold[id] = results[i];
  });
  return { generatedAt: new Date().toISOString(), gold };
}
