import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const startups = JSON.parse(readFileSync(join(root, 'data', 'world-startups.json'), 'utf8'));

const has = (v) => v !== null && v !== undefined && v !== '';

function score(s) {
  let n = 0;
  if (typeof s.description === 'string' && s.description.trim().length >= 60) n++;
  if (has(s.website)) n++;
  if (has(s.country) && s.country !== 'Unknown') n++;
  if (has(s.founded)) n++;
  if (has(s.totalFunding) || has(s.valuation)) n++;
  if ((Array.isArray(s.investors) && s.investors.length >= 2) ||
      (Array.isArray(s.rounds) && s.rounds.length >= 1)) n++;
  return n;
}

const rows = startups.map((s) => {
  const sc = score(s);
  const documented = sc >= 3 || has(s.valuation) || s.name === 'Cala AI';
  return { id: s.id, name: s.name, score: sc, documented };
});

const undocumented = rows.filter((r) => !r.documented);
const documentedCount = rows.length - undocumented.length;

const histogram = Array(7).fill(0);
for (const r of rows) histogram[r.score]++;

mkdirSync(join(root, '.cache'), { recursive: true });
writeFileSync(
  join(root, '.cache', 'undocumented.json'),
  JSON.stringify(undocumented.map((r) => r.id), null, 2),
);

console.log(`total: ${rows.length}`);
console.log(`documented: ${documentedCount}`);
console.log(`undocumented: ${undocumented.length}`);
console.log('histogram (score: count):');
histogram.forEach((c, i) => console.log(`  ${i}: ${c}`));
console.log('15 random undocumented:');
const pool = [...undocumented];
for (let i = 0; i < 15 && pool.length; i++) {
  const [r] = pool.splice(Math.floor(Math.random() * pool.length), 1);
  console.log(`  [${r.score}] ${r.name}`);
}
