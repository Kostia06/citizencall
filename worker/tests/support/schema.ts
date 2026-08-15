// Shared test bootstrap: applies worker/schema.sql (runs/hops/caches) to the
// workers-pool D1 binding. Vite raw import: the file content is inlined at
// build time, so this works inside workerd with no filesystem access.
// @ts-expect-error -- ?raw is a Vite loader convention, not a real module
import schemaSql from '../../schema.sql?raw';

// D1Database.exec() requires exactly one statement per newline-separated
// chunk — comments and multi-line CREATE TABLE statements both violate that,
// so schema.sql (written for readability, not for exec()) needs reflowing.
function toExecStatements(sql: string): string {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((stmt) => stmt.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(';\n');
}

export async function applyCoreSchema(db: D1Database): Promise<void> {
  await db.exec(toExecStatements(schemaSql as unknown as string));
}
