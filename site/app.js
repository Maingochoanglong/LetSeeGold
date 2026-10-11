import { CHI_PER_LUONG, CURRENCIES, SHOPS, collectAll, worldToVndPerLuong } from './sources.js';
import { INTERVALS, MODES, describeRun, isTime, nextRun, normalizeTimes } from './schedule.js';
import { convert, parseAmount } from './convert.js';

const DATA_URL = 'data/latest.json';
const SETTINGS_KEY = 'letseegold:settings:v1';
const PRICES_KEY = 'letseegold:prices:v1';
// Shops whose own APIs allow the browser to read them directly (CORS).
const LIVE_SHOPS = SHOPS.filter((s) => s.browser).map((s) => s.id);
const TICK_MS = 20_000;

const DEFAULTS = {
  mode: 'times',
  times: ['08:30', '11:30', '14:30', '17:00'],
  every: 15,
  from: '08:00',
  to: '18:00',
  notify: false,
  notifyOnlyChange: false,
  unit: 'luong',
  tab: 'all',
  compare: 'sjc',
  conv: { amount: '100', from: 'USD', to: 'VND' },
};

const COMPARE = {
  sjc: { label: 'Vàng miếng SJC', match: (n) => /SJC/i.test(n) && !/nhẫn|nữ trang|trang sức/i.test(n) },
  ring: { label: 'Nhẫn trơn 9999', match: (n) => /nhẫn/i.test(n) },
};

// ---------------------------------------------------------------------------
// Storage (wrapped: private mode or blocked storage must not break the page)

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function sanitize(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!MODES.includes(s.mode)) s.mode = DEFAULTS.mode;
  s.times = normalizeTimes(s.times);
  s.every = INTERVALS.includes(Number(s.every)) ? Number(s.every) : DEFAULTS.every;
  if (!isTime(s.from)) s.from = DEFAULTS.from;
  if (!isTime(s.to)) s.to = DEFAULTS.to;
  s.notify = Boolean(s.notify);
  s.notifyOnlyChange = Boolean(s.notifyOnlyChange);
  if (!['luong', 'chi'].includes(s.unit)) s.unit = 'luong';
  if (s.tab !== 'all' && !SHOPS.some((x) => x.id === s.tab)) s.tab = 'all';
  if (!COMPARE[s.compare]) s.compare = 'sjc';
  const codes = ['VND', ...CURRENCIES.map((c) => c.code)];
  s.conv = { ...DEFAULTS.conv, ...(s.conv || {}) };
  if (!codes.includes(s.conv.from)) s.conv.from = 'USD';
  if (!codes.includes(s.conv.to)) s.conv.to = 'VND';
  return s;
}

let settings = sanitize(load(SETTINGS_KEY));
const saveSettings = () => save(SETTINGS_KEY, settings);

const state = {
  snapshot: null,
  snapshotError: null,
  live: null,
  checkedAt: null,
  view: null,
  changed: new Set(),
  nextRunAt: null,
};

// ---------------------------------------------------------------------------
// Formatting

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const unitDiv = () => (settings.unit === 'chi' ? CHI_PER_LUONG : 1);
const unitLabel = () => (settings.unit === 'chi' ? 'đ/chỉ' : 'đ/lượng');

function fmtPrice(v) {
  return v == null ? '—' : nf0.format(Math.round(v / unitDiv()));
}

function fmtRate(v) {
  if (v == null) return '—';
  return v >= 1000 ? nf0.format(v) : nf2.format(v);
}

function fmtMillions(v) {
  return v == null ? '—' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v / 1e6)} tr`;
}

function fmtTime(iso, withDate = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${hm} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : hm;
}

function fmtMoney(v, code) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (code === 'VND') return `${nf0.format(Math.round(v))} ₫`;
  const c = CURRENCIES.find((x) => x.code === code);
  const f = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: c?.digits ?? 2, minimumFractionDigits: 0 });
  return `${f.format(v)} ${code}`;
}

/** "▲ 500.000" style change versus the reference (previous day) price. */
function change(cur, ref, fmt = (v) => nf0.format(Math.round(Math.abs(v) / unitDiv()))) {
  if (cur == null || ref == null) return '';
  const diff = cur - ref;
  if (Math.abs(diff) < 1e-9) return '';
  const cls = diff > 0 ? 'up' : 'down';
  return `<span class="chg ${cls}">${diff > 0 ? '▲' : '▼'} ${fmt(diff)}</span>`;
}

// ---------------------------------------------------------------------------
// Data

async function fetchSnapshot() {
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function buildView() {
  const snap = state.snapshot || {};
  const gold = {};
  for (const shop of SHOPS) {
    const live = state.live?.gold?.[shop.id];
    const stored = snap.gold?.[shop.id];
    gold[shop.id] = live?.ok ? { ...live, live: true } : stored || live || null;
  }
  const liveWorld = state.live?.world;
  return {
    gold,
    fx: snap.fx || null,
    world: liveWorld?.ok ? liveWorld : snap.world || null,
    ref: snap.ref || null,
  };
}

function flatPrices(view) {
  const out = {};
  for (const s of Object.values(view.gold)) {
    if (s?.ok) for (const i of s.items) out[i.key] = [i.buy, i.sell];
  }
  return out;
}

let refreshing = null;

function refresh(reason) {
  if (refreshing) return refreshing;
  setLoading(true);
  refreshing = (async () => {
    const [snap, live] = await Promise.all([
      fetchSnapshot().then(
        (s) => ({ s }),
        (e) => ({ e }),
      ),
      collectAll({ only: LIVE_SHOPS, includeFx: false }).catch(() => null),
    ]);
    if (snap.s) {
      state.snapshot = snap.s;
      state.snapshotError = null;
    } else {
      state.snapshotError = snap.e?.message || 'lỗi mạng';
    }
    if (live) state.live = live;
    state.checkedAt = new Date();

    const view = buildView();
    const prices = flatPrices(view);
    const before = load(PRICES_KEY);
    state.changed = new Set(
      Object.keys(prices).filter((k) => before?.[k] && (before[k][0] !== prices[k][0] || before[k][1] !== prices[k][1])),
    );
    save(PRICES_KEY, prices);
    state.view = view;
    render();
    if (reason === 'schedule') {
      notify(view, state.changed.size > 0);
      toast(`Đã cập nhật giá lúc ${fmtTime(state.checkedAt, false)}${state.changed.size ? ' – có giá thay đổi' : ''}`);
    }
  })().finally(() => {
    refreshing = null;
    setLoading(false);
  });
  return refreshing;
}

// ---------------------------------------------------------------------------
// Rendering

function render() {
  if (!state.view) return;
  renderStatus();
  renderTabs();
  renderWorld();
  renderCompare();
  renderShops();
  renderFx();
  renderConverter();
  renderSources();
}

function renderStatus() {
  const v = state.view;
  const total = SHOPS.length;
  const ok = SHOPS.filter((s) => v.gold[s.id]?.ok).length;
  const dot = $('#status-dot');
  dot.className = `dot ${ok === total && !state.snapshotError ? 'ok' : ok ? 'warn' : 'err'}`;
  let text = `Cập nhật lúc ${fmtTime(state.checkedAt?.toISOString(), false)} · ${ok}/${total} cửa hàng có giá`;
  if (state.snapshotError) text += ' · chưa tải được dữ liệu máy chủ';
  $('#status-text').textContent = text;
}

function renderSchedule() {
  const el = $('#schedule-text');
  if (settings.mode === 'manual') {
    el.textContent = 'Lịch: thủ công – bấm “Cập nhật” để lấy giá mới.';
  } else if (!state.nextRunAt) {
    el.textContent = 'Lịch: chưa có giờ cập nhật nào – mở “Lịch cập nhật” để thêm.';
  } else {
    const what =
      settings.mode === 'times'
        ? `vào ${settings.times.join(', ')} mỗi ngày`
        : `mỗi ${settings.every >= 60 ? `${settings.every / 60} giờ` : `${settings.every} phút`} từ ${settings.from} đến ${settings.to}`;
    el.textContent = `Lịch: ${what} · lần tới ${describeRun(state.nextRunAt)}${settings.notify ? ' · có thông báo' : ''}`;
  }
}

function renderTabs() {
  const tabs = [{ id: 'all', name: 'Tất cả' }, ...SHOPS];
  $('#shop-tabs').innerHTML = tabs
    .map((t) => {
      const s = t.id === 'all' ? null : state.view.gold[t.id];
      const warn = s && (!s.ok || s.stale) ? '<span class="warn-mark" title="Dữ liệu chưa mới">⚠</span>' : '';
      return `<button class="chip" role="tab" type="button" data-tab="${t.id}" aria-selected="${settings.tab === t.id}">${esc(t.name)}${warn}</button>`;
    })
    .join('');
}

function renderWorld() {
  const el = $('#world-gold');
  const w = state.view.world;
  const usd = state.view.fx?.rates?.USD;
  if (!w?.ok) {
    el.hidden = true;
    return;
  }
  const vnd = worldToVndPerLuong(w.usdPerOunce, usd?.sell || usd?.transfer);
  const sjcSell = pick(state.view.gold.sjc, COMPARE.sjc.match)?.sell;
  const ref = state.view.ref?.prices?.['world:xau']?.[0];
  const parts = [
    `<span>Thế giới: <b>${nf2.format(w.usdPerOunce)} USD/oz</b>${change(w.usdPerOunce, ref, (d) => nf2.format(Math.abs(d)))}</span>`,
  ];
  if (vnd) parts.push(`<span>≈ <b>${fmtPrice(vnd)}</b> ${unitLabel()} (quy đổi theo giá bán USD)</span>`);
  if (vnd && sjcSell) {
    const gap = sjcSell - vnd;
    parts.push(`<span>SJC ${gap >= 0 ? 'cao' : 'thấp'} hơn thế giới: <b>${fmtPrice(Math.abs(gap))}</b></span>`);
  }
  el.innerHTML = parts.join('');
  el.hidden = false;
}

function pick(shop, match) {
  return shop?.ok ? shop.items.find((i) => match(i.name)) : null;
}

function renderCompare() {
  const el = $('#compare');
  if (settings.tab !== 'all') {
    el.hidden = true;
    return;
  }
  const c = COMPARE[settings.compare];
  const rows = SHOPS.map((s) => ({ shop: s, item: pick(state.view.gold[s.id], c.match) })).filter((r) => r.item);
  const buys = rows.map((r) => r.item.buy).filter((v) => v != null);
  const sells = rows.map((r) => r.item.sell).filter((v) => v != null);
  const bestBuy = buys.length > 1 ? Math.max(...buys) : null;
  const bestSell = sells.length > 1 ? Math.min(...sells) : null;
  const seg = Object.entries(COMPARE)
    .map(([id, x]) => `<button type="button" role="radio" data-compare="${id}" aria-checked="${settings.compare === id}">${x.label}</button>`)
    .join('');
  const body = rows.length
    ? rows
        .map(({ shop, item }) => {
          const spread = item.buy != null && item.sell != null ? fmtPrice(item.sell - item.buy) : '—';
          return `<tr>
            <td><button type="button" class="link" data-tab="${shop.id}">${esc(shop.name)}</button><small class="muted">${esc(item.name)}</small></td>
            <td class="num${item.buy != null && item.buy === bestBuy ? ' best' : ''}" data-label="Mua">${fmtPrice(item.buy)}</td>
            <td class="num${item.sell != null && item.sell === bestSell ? ' best' : ''}" data-label="Bán">${fmtPrice(item.sell)}</td>
            <td class="num muted spread">${spread}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="4" class="muted">Chưa có dữ liệu.</td></tr>';
  el.innerHTML = `
    <div class="compare-head">
      <h2>So sánh nhanh</h2>
      <div class="seg" role="radiogroup" aria-label="Loại vàng so sánh">${seg}</div>
    </div>
    <div class="table-wrap">
      <table class="table compare-table">
        <thead><tr><th>Cửa hàng</th><th class="num">Mua vào</th><th class="num">Bán ra</th><th class="num spread">Chênh lệch</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="muted small">Đơn vị ${unitLabel()}. <span class="best-key">Ô nổi bật</span>: tiệm mua vào cao nhất / bán ra thấp nhất.</p>`;
  el.hidden = false;
}

function renderShops() {
  const ref = state.view.ref;
  const note = $('#ref-note');
  note.hidden = !ref;
  if (ref) {
    const [y, m, d] = ref.date.split('-');
    note.textContent = `▲▼ so với giá cuối ngày ${d}/${m}/${y}. Đơn vị: ${unitLabel()}.`;
  }
  const shops = settings.tab === 'all' ? SHOPS : SHOPS.filter((s) => s.id === settings.tab);
  $('#shops').innerHTML = shops.map((shop) => renderShop(shop, state.view.gold[shop.id], ref?.prices || {})).join('');
}

function renderShop(shop, data, refPrices) {
  const badges = [];
  if (data?.live) badges.push('<span class="badge live" title="Lấy trực tiếp từ website của cửa hàng">Trực tiếp</span>');
  if (data?.stale) badges.push(`<span class="badge stale" title="${esc(data.error || '')}">Dữ liệu cũ</span>`);
  const sub = [data?.region, data?.via ? `nguồn ${data.via}` : null].filter(Boolean).join(' · ');
  const time = data?.ok ? fmtTime(data.sourceTime || data.fetchedAt) : '';

  let body;
  if (!data?.ok) {
    body = `<div class="shop-error">Chưa lấy được giá${data?.error ? ` (${esc(data.error)})` : ''}. Hệ thống sẽ thử lại ở lần cập nhật sau.</div>`;
  } else {
    const rows = data.items
      .map((i) => {
        const r = refPrices[i.key] || [];
        const flash = state.changed.has(i.key) ? ' flash' : '';
        return `<tr class="${flash}">
          <td>${esc(i.name)}</td>
          <td class="num" data-label="Mua">${fmtPrice(i.buy)}${change(i.buy, r[0])}</td>
          <td class="num" data-label="Bán">${fmtPrice(i.sell)}${change(i.sell, r[1])}</td>
        </tr>`;
      })
      .join('');
    body = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Loại vàng</th><th class="num">Mua vào</th><th class="num">Bán ra</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    if (data.note) body += `<div class="shop-note">${esc(data.note)}</div>`;
  }

  return `<article class="shop" id="shop-${shop.id}">
    <header class="shop-head">
      <div>
        <h3><a href="${esc(shop.website)}" target="_blank" rel="noopener" title="${esc(shop.fullName)}">${esc(shop.name)}</a>${badges.join('')}</h3>
        ${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}
      </div>
      ${time ? `<div class="shop-meta">Giá lúc<br><b>${time}</b></div>` : ''}
    </header>
    ${body}
  </article>`;
}

function renderFx() {
  const fx = state.view.fx;
  const ref = state.view.ref?.prices || {};
  $('#fx-source').textContent = fx?.ok
    ? `Nguồn: ${fx.source}${fx.sourceTime ? ` · ${fmtTime(fx.sourceTime)}` : ''}${fx.stale ? ' · dữ liệu cũ' : ''}`
    : '';
  $('#fx-body').innerHTML = CURRENCIES.map((c) => {
    const r = fx?.ok ? fx.rates[c.code] : null;
    const [refTransfer, refSell] = ref[`fx:${c.code}`] || [];
    const fmt = (d) => fmtRate(Math.abs(d));
    return `<tr>
      <td><div class="cur"><span class="flag" aria-hidden="true">${c.flag}</span><div><b>${c.code}</b><small>${esc(c.name)}</small></div></div></td>
      <td class="num">${fmtRate(r?.cash)}</td>
      <td class="num">${fmtRate(r?.transfer)}${change(r?.transfer, refTransfer, fmt)}</td>
      <td class="num">${fmtRate(r?.sell)}${change(r?.sell, refSell, fmt)}</td>
    </tr>`;
  }).join('');
  if (!fx?.ok) {
    $('#fx-body').insertAdjacentHTML(
      'beforeend',
      `<tr><td colspan="4" class="muted">Chưa lấy được tỉ giá${fx?.error ? ` (${esc(fx.error)})` : ''}.</td></tr>`,
    );
  }
}

// ---------------------------------------------------------------------------
// Currency converter

const CONV_CODES = ['VND', ...CURRENCIES.map((c) => c.code)];

const SIDE = { buy: 'ngân hàng mua vào', sell: 'ngân hàng bán ra' };
const legNote = (l) => `1 ${l.code} = ${fmtRate(l.rate)} ₫ (${SIDE[l.side]})`;

function setupConverter() {
  const opts = CONV_CODES.map((code) => {
    const c = CURRENCIES.find((x) => x.code === code);
    return `<option value="${code}">${c ? `${c.flag} ${code} – ${c.name}` : '🇻🇳 VND – Việt Nam đồng'}</option>`;
  }).join('');
  $('#conv-from').innerHTML = opts;
  $('#conv-to').innerHTML = opts;
  $('#conv-amount').value = settings.conv.amount;
  $('#conv-from').value = settings.conv.from;
  $('#conv-to').value = settings.conv.to;

  const onChange = () => {
    settings.conv = { amount: $('#conv-amount').value, from: $('#conv-from').value, to: $('#conv-to').value };
    saveSettings();
    renderConverter();
  };
  $('#conv-amount').addEventListener('input', onChange);
  $('#conv-from').addEventListener('change', onChange);
  $('#conv-to').addEventListener('change', onChange);
  $('#conv-swap').addEventListener('click', () => {
    const f = $('#conv-from').value;
    $('#conv-from').value = $('#conv-to').value;
    $('#conv-to').value = f;
    onChange();
  });
}

function renderConverter() {
  const rates = state.view?.fx?.ok ? state.view.fx.rates : null;
  const { from, to } = settings.conv;
  const amount = parseAmount(settings.conv.amount);
  const result = $('#conv-result');
  const all = $('#conv-all');
  const note = $('#conv-note');
  if (!rates) {
    result.innerHTML = '<small>Đang chờ tỉ giá…</small>';
    all.innerHTML = '';
    note.textContent = '';
    return;
  }
  if (amount == null) {
    result.innerHTML = '<small>Nhập số tiền hợp lệ, ví dụ 100 hoặc 1.000.000</small>';
    all.innerHTML = '';
    note.textContent = '';
    return;
  }
  const main = convert(amount, from, to, rates);
  result.innerHTML = main
    ? `<small>${esc(fmtMoney(amount, from))} =</small>${esc(fmtMoney(main.value, to))}`
    : '<small>Không có tỉ giá cho loại tiền này.</small>';
  all.innerHTML = CONV_CODES.filter((c) => c !== from && c !== to)
    .map((c) => {
      const r = convert(amount, from, c, rates);
      return r ? `<span>${esc(fmtMoney(r.value, c))}</span>` : '';
    })
    .join('');
  note.textContent = main?.legs.length
    ? `Tính theo tỉ giá ${state.view.fx.source}: ${main.legs.map(legNote).join(' · ')}. Giao dịch tiền mặt có thể chênh lệch.`
    : '';
}

function renderSources() {
  const links = SHOPS.map((s) => `<a href="${esc(s.website)}" target="_blank" rel="noopener">${esc(s.name)}</a>`);
  $('#sources').innerHTML =
    `Nguồn giá: ${links.join(', ')}; SJC, DOJI, Bảo Tín Minh Châu qua <a href="https://giavang.org" target="_blank" rel="noopener">giavang.org</a>. ` +
    `Tỉ giá: <a href="https://www.vietcombank.com.vn/vi-VN/KHCN/Cong-cu-Tien-ich/Ty-gia" target="_blank" rel="noopener">Vietcombank</a>. ` +
    `Giá thế giới: <a href="https://gold-api.com" target="_blank" rel="noopener">gold-api.com</a>.` +
    (state.snapshot?.generatedAt ? ` Máy chủ tổng hợp lúc ${fmtTime(state.snapshot.generatedAt)}.` : '');
}

// ---------------------------------------------------------------------------
// Schedule

let timer = null;

function scheduleNext() {
  state.nextRunAt = nextRun(settings, new Date());
  clearTimeout(timer);
  if (state.nextRunAt) {
    const delay = state.nextRunAt.getTime() - Date.now();
    // Long timeouts are unreliable (sleep, throttling); the ticker below is the safety net.
    if (delay < 6 * 3600 * 1000) timer = setTimeout(tick, Math.max(0, delay) + 50);
  }
  renderSchedule();
}

function tick() {
  if (!state.nextRunAt || Date.now() < state.nextRunAt.getTime()) return;
  state.nextRunAt = null;
  refresh('schedule').finally(scheduleNext);
}

// ---------------------------------------------------------------------------
// Notifications

const canNotify = () => 'Notification' in window;

async function showNotification(title, body) {
  const options = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'letseegold-price', renotify: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, options);
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, options);
  } catch {
    /* Some mobile browsers only allow notifications from a service worker. */
  }
}

function notify(view, changed) {
  if (!settings.notify || !canNotify() || Notification.permission !== 'granted') return;
  if (settings.notifyOnlyChange && !changed) return;
  const lines = SHOPS.map((s) => {
    const item = pick(view.gold[s.id], COMPARE.sjc.match) || (view.gold[s.id]?.ok ? view.gold[s.id].items[0] : null);
    return item ? `${s.name}: ${fmtMillions(item.buy)} / ${fmtMillions(item.sell)}` : null;
  }).filter(Boolean);
  const title = `Giá vàng lúc ${fmtTime(new Date().toISOString(), false)}${changed ? ' – có thay đổi' : ''}`;
  showNotification(title, `Mua / bán (đ/lượng)\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Settings dialog

let draftTimes = [];

function openSettings() {
  const form = $('#settings-form');
  form.elements.mode.value = settings.mode;
  form.elements.every.value = String(settings.every);
  form.elements.from.value = settings.from;
  form.elements.to.value = settings.to;
  form.elements.notify.checked = settings.notify && canNotify() && Notification.permission === 'granted';
  form.elements.notifyOnlyChange.checked = settings.notifyOnlyChange;
  form.elements.notify.disabled = !canNotify();
  draftTimes = [...settings.times];
  renderTimeList();
  syncModeFields();
  $('#settings').showModal();
}

function syncModeFields() {
  const mode = $('#settings-form').elements.mode.value;
  document.querySelectorAll('#settings fieldset[data-mode]').forEach((f) => {
    f.hidden = f.dataset.mode !== mode;
  });
}

function renderTimeList() {
  $('#time-list').innerHTML = draftTimes
    .map((t) => `<span class="time-pill">${t}<button type="button" data-remove="${t}" aria-label="Xoá ${t}">✕</button></span>`)
    .join('');
}

function applySettings() {
  const f = $('#settings-form').elements;
  settings = sanitize({
    ...settings,
    mode: f.mode.value,
    times: draftTimes,
    every: Number(f.every.value),
    from: f.from.value,
    to: f.to.value,
    notify: f.notify.checked,
    notifyOnlyChange: f.notifyOnlyChange.checked,
  });
  saveSettings();
  scheduleNext();
  toast(settings.mode === 'manual' ? 'Đã chuyển sang cập nhật thủ công' : `Đã lưu lịch. Lần tới: ${describeRun(state.nextRunAt)}`);
}

function setupSettings() {
  const form = $('#settings-form');
  $('#btn-settings').addEventListener('click', openSettings);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'mode') syncModeFields();
    if (e.target.name === 'notify' && e.target.checked && canNotify() && Notification.permission !== 'granted') {
      Notification.requestPermission().then((p) => {
        if (p !== 'granted') {
          e.target.checked = false;
          toast('Trình duyệt chưa cho phép thông báo. Hãy bật quyền thông báo cho trang này.');
        }
      });
    }
  });
  $('#time-add').addEventListener('click', () => {
    const v = $('#time-new').value;
    if (!isTime(v)) return toast('Giờ không hợp lệ');
    draftTimes = normalizeTimes([...draftTimes, v]);
    renderTimeList();
  });
  $('#time-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-remove]')?.dataset.remove;
    if (!t) return;
    draftTimes = draftTimes.filter((x) => x !== t);
    renderTimeList();
  });
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue === 'save') applySettings();
  });
}

// ---------------------------------------------------------------------------
// Misc UI

let toastTimer = null;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function setLoading(on) {
  $('#btn-refresh').classList.toggle('loading', on);
  $('#btn-refresh').disabled = on;
}

function setupControls() {
  $('#btn-refresh').addEventListener('click', () => refresh('manual'));

  document.querySelectorAll('[data-unit]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.unit === settings.unit));
    b.addEventListener('click', () => {
      settings.unit = b.dataset.unit;
      saveSettings();
      document.querySelectorAll('[data-unit]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      render();
    });
  });

  // Tabs and compare buttons are re-rendered, so listen on the containers.
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      settings.tab = tab.dataset.tab;
      saveSettings();
      render();
      if (tab.classList.contains('link')) $('#shops').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const cmp = e.target.closest('[data-compare]');
    if (cmp) {
      settings.compare = cmp.dataset.compare;
      saveSettings();
      renderCompare();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  setInterval(tick, TICK_MS);
}

// ---------------------------------------------------------------------------

setupControls();
setupSettings();
setupConverter();
scheduleNext();
refresh('load');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
