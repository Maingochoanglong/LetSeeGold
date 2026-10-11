// Combines a fresh fetch with the previously deployed snapshot.

import { vnDate } from '../site/sources.js';

// A source that keeps failing stops being shown after this long.
export const MAX_STALE_MS = 3 * 24 * 3600 * 1000;

/** Flat map of every price in a snapshot: key -> [buy, sell]. */
export function pricesOf(snapshot) {
  const prices = {};
  for (const s of Object.values(snapshot?.gold || {})) {
    for (const i of s?.items || []) prices[i.key] = [i.buy, i.sell];
  }
  for (const [code, r] of Object.entries(snapshot?.fx?.rates || {})) {
    prices[`fx:${code}`] = [r.transfer, r.sell];
  }
  if (snapshot?.world?.usdPerOunce) prices['world:xau'] = [snapshot.world.usdPerOunce, null];
  return prices;
}

function withFallback(fresh, old, now) {
  if (fresh?.ok || !old?.ok) return fresh;
  const age = now - new Date(old.fetchedAt).getTime();
  if (!(age < MAX_STALE_MS)) return fresh;
  return { ...old, stale: true, error: fresh?.error || null, lastTriedAt: fresh?.fetchedAt || null };
}

export function mergeSnapshot(fresh, prev, now = Date.now()) {
  const gold = {};
  for (const [id, s] of Object.entries(fresh.gold)) gold[id] = withFallback(s, prev?.gold?.[id], now);

  const merged = {
    version: 1,
    generatedAt: fresh.generatedAt,
    gold,
    fx: withFallback(fresh.fx, prev?.fx, now),
    world: withFallback(fresh.world, prev?.world, now),
  };

  // Reference prices for the ▲/▼ column: the last snapshot of the previous day.
  const today = vnDate(fresh.generatedAt);
  const prevDay = prev?.generatedAt ? vnDate(prev.generatedAt) : null;
  if (prevDay && prevDay < today) merged.ref = { date: prevDay, prices: pricesOf(prev) };
  else if (prev?.ref && prev.ref.date < today) merged.ref = prev.ref;
  else merged.ref = null;

  return merged;
}
