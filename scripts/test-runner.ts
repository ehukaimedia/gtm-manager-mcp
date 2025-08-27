#!/usr/bin/env node
/* Minimal TS test runner (ESM) */
import fs from 'fs';
import path from 'path';
import url from 'url';

process.env.MCP_NO_MAIN = '1';

type TestResult = { file: string; passed: number; failed: number; errors: string[] };

function errToString(e: any): string {
  try {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    if (e.stack) return String(e.stack);
    if (e.message) return String(e.message);
    return JSON.stringify(e);
  } catch {
    return 'Unprintable error';
  }
}

async function findTests(): Promise<string[]> {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, 'src', '__tests__'), path.join(cwd, 'tests')];
  const files: string[] = [];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.test\.ts$/.test(entry.name)) files.push(p);
      }
    };
    walk(base);
  }
  return files;
}

async function runTestFile(file: string): Promise<TestResult> {
  let mod: any;
  try {
    mod = await import(url.pathToFileURL(file).href);
  } catch (e: any) {
    return { file, passed: 0, failed: 1, errors: [errToString(e)] };
  }
  const runner: (() => Promise<void>) | undefined = mod.default || mod.run || mod.test;
  const result: TestResult = { file, passed: 0, failed: 0, errors: [] };
  if (!runner) {
    result.failed++;
    result.errors.push('No default export/run/test function found');
    return result;
  }
  try {
    await runner();
    result.passed++;
  } catch (err: any) {
    result.failed++;
    result.errors.push(errToString(err));
  }
  return result;
}

(async () => {
  const files = await findTests();
  if (files.length === 0) {
    console.log('(no tests found)');
    process.exit(0);
  }
  const results: TestResult[] = [];
  for (const f of files) {
    results.push(await runTestFile(f));
  }
  const passed = results.reduce((a, r) => a + r.passed, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  for (const r of results) {
    const rel = path.relative(process.cwd(), r.file);
    if (r.failed === 0) {
      console.log(`ok - ${rel}`);
    } else {
      console.log(`not ok - ${rel}`);
      for (const e of r.errors) console.log(e);
    }
  }
  if (failed > 0) process.exit(1);
})();
