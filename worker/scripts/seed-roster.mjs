// Loads artifacts/roster.json into the D1 `roster` table, which is what
// GET /api/roster serves and what the demo opens on (SPEC.md §12, §15 0:00).
//
// This is the missing link between the offline harness and the Worker:
// promote.py decides promotions, but nothing carried them into D1, so
// /api/roster returned [] and /roster rendered an empty table.
//
//   node scripts/seed-roster.mjs            # local D1 (wrangler dev)
//   node scripts/seed-roster.mjs --remote   # deployed D1
//
// REFUSES to load stub data unless --allow-stub is passed. The roster is the
// credibility screen; seeding it from a `promote.py --offline` run would put
// invented accuracy figures on the opening shot of the demo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rosterPath = join(here, '..', '..', 'artifacts', 'roster.json');

const remote = process.argv.includes('--remote');
const allowStub = process.argv.includes('--allow-stub');

let doc;
try {
  doc = JSON.parse(readFileSync(rosterPath, 'utf8'));
} catch {
  console.error(
    `[seed-roster] no artifacts/roster.json.\n` +
      `  Produce one first:  cd harness && python promote.py --live\n` +
      `  (--offline works too, but writes stub numbers this script will refuse.)`,
  );
  process.exit(1);
}

const rows = doc.roster ?? [];
if (doc.provenance !== 'live-featherless' && !allowStub) {
  console.error(
    `[seed-roster] refusing to seed: roster.json provenance is "${doc.provenance}".\n` +
      `  ${doc.note ?? ''}\n` +
      `  The roster is the demo's opening screen — seeding stub accuracy there would\n` +
      `  misrepresent measured results. Re-run: cd harness && python promote.py --live\n` +
      `  To load it anyway (local experiments only): --allow-stub`,
  );
  process.exit(1);
}

if (rows.length === 0) {
  console.error(
    `[seed-roster] roster.json lists no promotions — nothing to seed.\n` +
      `  That is a legitimate outcome: no candidate beat the incumbent under the\n` +
      `  §9.4 rule. SPEC.md §21 covers how to report it.`,
  );
  process.exit(1);
}

const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? 'NULL' : Number(v));

const statements = rows.map((r) => {
  const promotedAt = Number.isFinite(Number(r.promotedAt))
    ? Number(r.promotedAt)
    : Date.parse(r.promotedAt) || Date.now();
  return (
    `INSERT INTO roster (task_kind, model_id, model_class, promoted_at, accuracy, ci_lo, ci_hi, ` +
    `cost_per_1k, displaced_model_id, hf_downloads) VALUES (` +
    `${esc(r.taskKind)}, ${esc(r.modelId)}, ${esc(r.modelClass)}, ${promotedAt}, ` +
    `${num(r.accuracy)}, ${num(r.ciLo)}, ${num(r.ciHi)}, ${num(r.costPer1k)}, ` +
    `${esc(r.displacedModelId)}, ${num(r.hfDownloads)}) ` +
    `ON CONFLICT(task_kind, model_id) DO UPDATE SET ` +
    `model_class=excluded.model_class, promoted_at=excluded.promoted_at, accuracy=excluded.accuracy, ` +
    `ci_lo=excluded.ci_lo, ci_hi=excluded.ci_hi, cost_per_1k=excluded.cost_per_1k, ` +
    `displaced_model_id=excluded.displaced_model_id, hf_downloads=excluded.hf_downloads;`
  );
});

const sql = statements.join('\n');
const args = ['wrangler', 'd1', 'execute', 'understudy', remote ? '--remote' : '--local', '--command', sql];

try {
  execFileSync('npx', args, { cwd: join(here, '..'), stdio: 'inherit' });
  console.log(
    `[seed-roster] seeded ${rows.length} promotion${rows.length === 1 ? '' : 's'} ` +
      `(${doc.provenance}) into ${remote ? 'remote' : 'local'} D1`,
  );
} catch {
  process.exit(1);
}
