// 静态完整性检查:
// 1. sw.js 的 PRECACHE 清单里的每个文件都真实存在
// 2. web/ 下的每个文件都进了 PRECACHE(否则离线会缺资源)
// 3. index.html 引用的本地资源都存在
// 4. 所有 JS 以 ESM 语法通过 node --check
// 作为 node --test 的一部分运行。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync, copyFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const WEB = new URL('../web/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const swSource = readFileSync(join(WEB, 'sw.js'), 'utf8');
const precache = [...swSource.matchAll(/'(\.\/[^']*)'/g)]
  .map((m) => m[1])
  .filter((p) => p !== './');

test('every PRECACHE entry exists on disk', () => {
  for (const entry of precache) {
    assert.ok(existsSync(join(WEB, entry)), `missing file for precache entry: ${entry}`);
  }
});

test('every file under web/ is precached', () => {
  const files = walk(WEB).map((p) => './' + relative(WEB, p));
  for (const f of files) {
    if (f === './sw.js') continue; // SW 自身由浏览器管理,不进缓存清单
    assert.ok(precache.includes(f), `file not in PRECACHE (offline would miss it): ${f}`);
  }
});

test('index.html local references exist', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !r.startsWith('http') && !r.startsWith('data:') && !r.startsWith('#'));
  assert.ok(refs.length >= 5, 'suspiciously few references parsed');
  for (const r of refs) {
    assert.ok(existsSync(join(WEB, r)), `index.html references missing file: ${r}`);
  }
});

test('all web JS parses as ES modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chunks-syntax-'));
  const jsFiles = walk(WEB).filter((p) => p.endsWith('.js'));
  assert.ok(jsFiles.length >= 10);
  for (const p of jsFiles) {
    const tmp = join(dir, relative(WEB, p).replaceAll('/', '__') + '.mjs');
    copyFileSync(p, tmp);
    execFileSync(process.execPath, ['--check', tmp]); // 语法错会抛非零退出
  }
});
