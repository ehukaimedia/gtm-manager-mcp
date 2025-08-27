#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';

async function findTests() {
  const base = path.join(process.cwd(), 'tests');
  const files = [];
  if (!fs.existsSync(base)) return files;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(p);
    }
  };
  walk(base);
  return files;
}

async function runTest(file) {
  const mod = await import(url.pathToFileURL(file).href);
  const fn = mod.default || mod.run || mod.test;
  if (!fn) throw new Error('No default/run/test export');
  await fn();
}

(async () => {
  const files = await findTests();
  if (files.length === 0) {
    console.log('(no tests found)');
    process.exit(0);
  }
  let failed = 0;
  for (const f of files) {
    try {
      await runTest(f);
      console.log(`ok - ${path.relative(process.cwd(), f)}`);
    } catch (e) {
      console.log(`not ok - ${path.relative(process.cwd(), f)}`);
      console.log(e?.stack || e?.message || String(e));
      failed++;
    }
  }
  if (failed > 0) process.exit(1);
})();

