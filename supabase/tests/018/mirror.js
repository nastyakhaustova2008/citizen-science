// 018 mirror test, JS side: the wizard's checks (src/lib/fields.js) must give exactly the
// database's answers (mirror.sql) for every string. Bundled with esbuild and run by run.sh:
//   node mirror.mjs <sql-output.json>
// Prints the long-text verdict per string (to eyeball false positives) and exits 1 on a mismatch.
import fs from 'node:fs';
import { cleanText, textError, PLACE_MAX, TEXT_MAX } from '../../../src/lib/fields.js';

const DOMAINS = ['ac.il', 'gov.il', 'wikipedia.org', 'youtu.be', 'youtube.com']; // 015 start list
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let bad = 0;
for (const [s, place, short, long, cleanPlace, clean] of rows) {
  const js = [
    textError(cleanText(s, true), PLACE_MAX, DOMAINS),
    textError(cleanText(s), TEXT_MAX.short, DOMAINS),
    textError(cleanText(s), TEXT_MAX.long, DOMAINS),
    cleanText(s, true) || null,
    cleanText(s) || null,
  ];
  const sql = [place, short, long, cleanPlace, clean];
  const same = JSON.stringify(js) === JSON.stringify(sql);
  if (!same) bad++;
  const shown = JSON.stringify(s.length > 50 ? `${s.slice(0, 47)}…` : s);
  console.log(`${same ? '    ' : 'DIFF'} ${(long || 'ok').padEnd(24)} ${shown}`);
  if (!same) console.log(`       js  ${JSON.stringify(js).slice(0, 160)}\n       sql ${JSON.stringify(sql).slice(0, 160)}`);
}
console.log(`\nmirror: ${rows.length} strings, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
