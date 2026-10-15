import { BROWSER_FETCHERS, CHI_PER_LUONG, CURRENCIES, SHOPS, collectAll, vnDate } from './sources.js';
import { INTERVALS, MODES, describeRun, isTime, nextRun, normalizeTimes } from './schedule.js';
import { convert, parseAmount } from './convert.js';

const DATA_URL = 'data/latest.json';
const BASE_TITLE = document.title;
const SETTINGS_KEY = 'letseegold:settings:v1';
const PRICES_KEY = 'letseegold:prices:v1';
const TICK_MS = 20_000;
const OLD_MS = 36 * 3600 * 1000;

const DEFAULTS = {
  mode: 'times',
  times: ['08:30', '11:30', '14:30', '17:00'],
  every: 15,
  from: '08:00',
  to: '18:00',
  notify: false,
  notifyOnlyChange: false,
  unit: 'luong',
  conv: { amount: '100', from: 'USD', to: 'VND' },
};

// The page shows one product per shop: its SJC gold bar.
const isSjcBar = (name) => /SJC/i.test(name) && !/nhẫn|nữ trang|trang sức/i.test(name);

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

const fmtToday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

// Gold prices are shown in thousands of đồng, as on the shops' own boards
// ("141.800" nghìn đồng/lượng instead of 141.800.000 đ).
const PRICE_SCALE = 1000;
const unitDiv = () => (settings.unit === 'chi' ? CHI_PER_LUONG : 1) * PRICE_SCALE;
const unitLabel = () => (settings.unit === 'chi' ? 'nghìn đồng/chỉ' : 'nghìn đồng/lượng');

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
  return { gold, fx: snap.fx || null, ref: snap.ref || null };
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
      collectAll({ fetchers: BROWSER_FETCHERS, includeFx: false }).catch(() => null),
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
  renderSummary();
  renderCompare();
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
  $('#today').textContent = fmtToday.format(state.checkedAt || new Date());
}

function renderSchedule() {
  const el = $('#schedule-text');
  let text;
  if (settings.mode === 'manual') {
    text = 'Cập nhật thủ công: bấm nút ⟳ để lấy giá mới.';
  } else if (!state.nextRunAt) {
    text = 'Chưa đặt giờ tự cập nhật.';
  } else {
    const what =
      settings.mode === 'times'
        ? `lúc ${settings.times.join(', ')}`
        : `mỗi ${settings.every >= 60 ? `${settings.every / 60} giờ` : `${settings.every} phút`}, ${settings.from}–${settings.to}`;
    text = `Tự cập nhật ${what} · lần tới ${describeRun(state.nextRunAt)}${settings.notify ? ' · có thông báo' : ''}`;
  }
  el.innerHTML = `${esc(text)} <button type="button" class="link" data-open-settings>Đổi lịch</button>`;
}

function sjcItem(shop) {
  return shop?.ok ? shop.items.find((i) => isSjcBar(i.name)) : null;
}

/** One row per shop that posts an SJC bar price, plus the best prices among them. */
function compareRows() {
  const rows = SHOPS.map((shop) => ({ shop, data: state.view.gold[shop.id] }))
    .map((r) => ({ ...r, item: sjcItem(r.data) }))
    .filter((r) => r.item);
  const buys = rows.map((r) => r.item.buy).filter((v) => v != null);
  const sells = rows.map((r) => r.item.sell).filter((v) => v != null);
  return {
    rows,
    bestBuy: buys.length > 1 ? Math.max(...buys) : null,
    bestSell: sells.length > 1 ? Math.min(...sells) : null,
  };
}

function shopNames(rows) {
  const names = rows.map((r) => r.shop.name);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

function renderSummary() {
  const { rows, bestBuy, bestSell } = compareRows();
  const tiles = [];
  if (bestBuy != null) {
    tiles.push(stat('Mua vào cao nhất', fmtPrice(bestBuy), esc(shopNames(rows.filter((r) => r.item.buy === bestBuy)))));
  }
  if (bestSell != null) {
    tiles.push(stat('Bán ra thấp nhất', fmtPrice(bestSell), esc(shopNames(rows.filter((r) => r.item.sell === bestSell)))));
  }
  document.title =
    bestBuy != null && bestSell != null ? `${fmtPrice(bestBuy)} / ${fmtPrice(bestSell)} · Giá vàng SJC – LetSeeGold` : BASE_TITLE;
  $('#summary').innerHTML = tiles.join('');
  $('#summary').hidden = tiles.length === 0;
}

function stat(label, value, sub) {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;
}

/** "Chính hãng · 10:08" – where the price came from and when the shop posted it. */
function sourceMeta(data) {
  const when = data.sourceTime || data.fetchedAt;
  const today = when && vnDate(when) === vnDate(new Date());
  const old = when && Date.now() - new Date(when).getTime() > OLD_MS;
  const src = data.via
    ? `<span class="src" title="Lấy qua trang tổng hợp ${esc(data.via)}">qua ${esc(data.via)}</span>`
    : '<span class="src official" title="Lấy trực tiếp từ website của cửa hàng">Chính hãng</span>';
  const time = when ? `<span class="time${old ? ' old' : ''}" title="${old ? 'Cửa hàng chưa đổi giá hơn một ngày' : 'Giờ cửa hàng niêm yết'}">${fmtTime(when, !today)}</span>` : '';
  const stale = data.stale ? `<span class="badge stale" title="${esc(data.error || '')}">Dữ liệu cũ</span>` : '';
  return `${src}${time}${stale}`;
}

function priceCell(label, value, ref, best) {
  const cls = value != null && value === best ? ' best' : '';
  return `<td class="num price${cls}" data-label="${label}"><span class="val">${fmtPrice(value)}</span>${change(value, ref)}</td>`;
}

function renderCompare() {
  const { rows, bestBuy, bestSell } = compareRows();
  const ref = state.view.ref?.prices || {};
  $('#compare-body').innerHTML = rows.length
    ? rows
        .map(({ shop, data, item }) => {
          const r = ref[item.key] || [];
          const spread = item.buy != null && item.sell != null ? fmtPrice(item.sell - item.buy) : '—';
          return `<tr class="${state.changed.has(item.key) ? 'flash' : ''}">
            <th scope="row" class="shop-cell">
              <a class="shop-link" href="${esc(shop.website)}" target="_blank" rel="noopener" title="${esc(shop.fullName)} – mở website">${esc(shop.name)}</a>
              <span class="meta"><span class="product">${esc(item.name)}</span>${sourceMeta(data)}</span>
            </th>
            ${priceCell('Mua', item.buy, r[0], bestBuy)}
            ${priceCell('Bán', item.sell, r[1], bestSell)}
            <td class="num spread">${spread}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="4" class="muted">Chưa có dữ liệu.</td></tr>';

  const missing = SHOPS.filter((s) => !rows.some((r) => r.shop.id === s.id));
  $('#legend').innerHTML = [
    `Đơn vị: <b>${unitLabel()}</b>.`,
    refNote(),
    bestBuy != null || bestSell != null ? '<span class="best-key">Ô vàng</span> là giá tốt nhất: mua vào cao nhất, bán ra thấp nhất.' : '',
    missing.length ? `Chưa có giá vàng miếng SJC của ${missing.map((s) => esc(s.name)).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function refNote() {
  const ref = state.view.ref;
  if (!ref) return '';
  const [y, m, d] = ref.date.split('-');
  return `▲▼ so với giá cuối ngày ${d}/${m}/${y}.`;
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
      <th scope="row"><div class="cur"><span class="flag" aria-hidden="true">${c.flag}</span><div><b>${c.code}</b><small>${esc(c.name)}</small></div></div></th>
      <td class="num cash">${fmtRate(r?.cash)}</td>
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
    return `<option value="${code}" title="${c ? c.name : 'Việt Nam đồng'}">${c ? c.flag : '🇻🇳'} ${code}</option>`;
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
    `Nguồn giá: ${links.join(', ')}. DOJI, Bảo Tín Minh Châu và SJC chặn truy cập từ nước ngoài nên được lấy qua ` +
    `<a href="https://giavang.org" target="_blank" rel="noopener">giavang.org</a>. ` +
    `Tỉ giá: <a href="https://www.vietcombank.com.vn/vi-VN/KHCN/Cong-cu-Tien-ich/Ty-gia" target="_blank" rel="noopener">Vietcombank</a>.` +
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
    const item = sjcItem(view.gold[s.id]);
    return item ? `${s.name}: ${fmtMillions(item.buy)} / ${fmtMillions(item.sell)}` : null;
  }).filter(Boolean);
  const title = `Giá vàng lúc ${fmtTime(new Date().toISOString(), false)}${changed ? ' – có thay đổi' : ''}`;
  showNotification(title, `Vàng miếng SJC – mua / bán (đ/lượng)\n${lines.join('\n')}`);
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

  // The schedule line is re-rendered, so listen on the document.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) openSettings();
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
