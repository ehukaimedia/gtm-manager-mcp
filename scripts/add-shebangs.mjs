// Post-build helper: ensure CLI entrypoints have a Node shebang.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const files = ['dist/bin.js', 'dist/callbackBin.js'];
const SHEBANG = '#!/usr/bin/env node\n';

for (const rel of files) {
  const p = join(process.cwd(), rel);
  if (!existsSync(p)) continue;
  const txt = readFileSync(p, 'utf8');
  if (txt.startsWith(SHEBANG)) {
    continue;
  }
  writeFileSync(p, SHEBANG + txt, 'utf8');
  console.log('prepended shebang to', rel);
}
