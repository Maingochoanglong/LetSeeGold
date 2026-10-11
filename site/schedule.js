// Update schedule chosen by the user, in the device's local time.
//
//   { mode: 'times', times: ['08:30', '14:00'] }              at fixed times every day
//   { mode: 'interval', every: 15, from: '08:00', to: '18:00' } every N minutes inside a window
//   { mode: 'manual' }                                         never on its own

export const MODES = ['times', 'interval', 'manual'];
export const INTERVALS = [5, 10, 15, 30, 60, 120];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function toMinutes(s) {
  const [, h, m] = TIME_RE.exec(s);
  return Number(h) * 60 + Number(m);
}

/** Sorted, de-duplicated list of valid "HH:MM" strings. */
export function normalizeTimes(times) {
  return [...new Set((Array.isArray(times) ? times : []).filter(isTime))].sort();
}

function at(base, dayOffset, minutes) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setMinutes(minutes);
  return d;
}

/** The next moment (strictly after `now`) an update should run, or null. */
export function nextRun(schedule, now = new Date()) {
  const t = now.getTime();
  if (schedule?.mode === 'times') {
    const mins = normalizeTimes(schedule.times).map(toMinutes);
    for (const day of [0, 1]) {
      for (const m of mins) {
        const d = at(now, day, m);
        if (d.getTime() > t) return d;
      }
    }
    return null;
  }
  if (schedule?.mode === 'interval') {
    const every = INTERVALS.includes(Number(schedule.every)) ? Number(schedule.every) : 15;
    if (!isTime(schedule.from) || !isTime(schedule.to)) return null;
    const from = toMinutes(schedule.from);
    let to = toMinutes(schedule.to);
    if (to <= from) to += 24 * 60; // window crosses midnight (or is the whole day)
    // Start from yesterday so a window that crosses midnight is covered.
    for (const day of [-1, 0, 1]) {
      for (let m = from; m <= to; m += every) {
        const d = at(now, day, m);
        if (d.getTime() > t) return d;
      }
    }
    return null;
  }
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

/** "14:30", "14:30 ngày mai" or "14:30 13/10". */
export function describeRun(date, now = new Date()) {
  if (!date) return '';
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const days = Math.round((at(date, 0, 0) - at(now, 0, 0)) / 86400000);
  if (days === 0) return `${hm} hôm nay`;
  if (days === 1) return `${hm} ngày mai`;
  return `${hm} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}
