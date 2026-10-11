// Currency conversion through VND with bank buy/sell rates.

/** Accepts "1.000.000", "1,000,000", "1000000", "2,5", "2.75". */
export function parseAmount(str) {
  let s = String(str ?? '').replace(/[\s₫]/g, '');
  if (!s) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (dot >= 0 || comma >= 0) {
    const parts = s.split(dot >= 0 ? '.' : ',');
    // "1.500" and "1.000.000" are thousands; "2,5" and "0.500" are decimals.
    const thousands = parts.length > 2 || (parts[1].length === 3 && parts[0] !== '0');
    s = thousands ? parts.join('') : parts.join('.');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * Converts `amount` of `from` into `to`. Foreign currency goes into VND at the
 * bank's buy rate (transfer, else cash) and out of VND at its sell rate, which
 * is what a customer actually gets. Returns null when a rate is missing.
 */
export function convert(amount, from, to, rates) {
  const legs = [];
  let vnd = amount;
  if (from !== to && from !== 'VND') {
    const r = rates?.[from];
    const rate = r?.transfer ?? r?.cash ?? r?.sell;
    if (!rate) return null;
    vnd = amount * rate;
    legs.push({ code: from, rate, side: 'buy' });
  }
  if (from === to || to === 'VND') return { value: from === to ? amount : vnd, legs };
  const r = rates?.[to];
  const rate = r?.sell ?? r?.transfer;
  if (!rate) return null;
  legs.push({ code: to, rate, side: 'sell' });
  return { value: vnd / rate, legs };
}
