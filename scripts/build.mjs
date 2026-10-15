// Fetches every source and writes the static site to dist/.
//
//   node scripts/build.mjs            # fetch live data, build dist/
//   PREV_URL=... node scripts/build.mjs
//
// PREV_URL points at the currently deployed data/latest.json. It is used to
// keep the last good prices of a source that is temporarily down, and to know
// the previous day's closing prices (for the ▲/▼ change column). On GitHub
// Actions it is derived from the repository name automatically.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll } from '../site/sources.js';
import { mergeSnapshot } from './snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function previousUrl() {
  if (process.env.PREV_URL !== undefined) return process.env.PREV_URL || null;
  const repo = process.env.GITHUB_REPOSITORY; // "Owner/Repo"
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  const base =
    name.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? `https://${owner.toLowerCase()}.github.io`
      : `https://${owner.toLowerCase()}.github.io/${name}`;
  return `${base}/data/latest.json`;
}

async function loadPrevious(url) {
  if (!url) return null;
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log(`Không có dữ liệu cũ (${res.status}) tại ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`Không tải được dữ liệu cũ: ${e.message}`);
    return null;
  }
}

const prevUrl = previousUrl();
const [fresh, prev] = await Promise.all([collectAll(), loadPrevious(prevUrl)]);
const snapshot = mergeSnapshot(fresh, prev);

for (const [id, s] of Object.entries(snapshot.gold)) {
  const status = s.ok ? `${s.items.length} dòng` : `LỖI: ${s.error}`;
  console.log(`${id.padEnd(8)} ${s.stale ? '(dữ liệu cũ) ' : ''}${status}`);
}

const okCount = Object.values(snapshot.gold).filter((s) => s.ok).length;
if (!okCount) {
  console.error('Không lấy được giá vàng từ nguồn nào – huỷ build để giữ bản đang chạy.');
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await cp(join(root, 'site'), dist, { recursive: true });
await mkdir(join(dist, 'data'), { recursive: true });
await writeFile(join(dist, 'data', 'latest.json'), JSON.stringify(snapshot));
await writeFile(join(dist, '.nojekyll'), '');
console.log(`Đã ghi ${join('dist', 'data', 'latest.json')}`);
