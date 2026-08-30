// D2: @rafter/engine is pure. No I/O, no DB, no network, no clock.
// Fails CI if engine imports anything beyond relative paths or @rafter/types,
// or references Date.now / new Date() without an explicit asOf parameter source.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../packages/engine/src', import.meta.url).pathname;
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) check(p);
  }
}

function check(file) {
  const src = readFileSync(file, 'utf8');
  const importRe = /(?:^|\n)\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = importRe.exec(src))) {
    const spec = m[1] ?? m[2];
    const ok = spec.startsWith('./') || spec.startsWith('../') || spec === '@rafter/types';
    if (!ok) violations.push(`${file}: illegal import "${spec}"`);
  }
  for (const banned of ['Date.now(', 'new Date()', 'process.env', 'fetch(', 'setTimeout(', 'Math.random(']) {
    if (src.includes(banned)) violations.push(`${file}: banned expression "${banned}"`);
  }
}

walk(ROOT);
if (violations.length) {
  console.error('ENGINE BOUNDARY VIOLATIONS:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('engine boundary clean');
