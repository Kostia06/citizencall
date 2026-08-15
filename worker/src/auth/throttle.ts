export async function checkAndIncrement(
  db: D1Database,
  bucket: string,
  now: number,
  opts: { windowMs: number; max: number }
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const row = await db
    .prepare(`SELECT window_start,count FROM auth_attempts WHERE bucket=?`)
    .bind(bucket)
    .first<{ window_start: number; count: number }>();

  if (!row || now - row.window_start >= opts.windowMs) {
    await db
      .prepare(
        `INSERT INTO auth_attempts(bucket,window_start,count) VALUES(?,?,1)
         ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start, count=1`
      )
      .bind(bucket, now)
      .run();
    return { allowed: true, retryAfterMs: 0 };
  }
  if (row.count >= opts.max) {
    return { allowed: false, retryAfterMs: opts.windowMs - (now - row.window_start) };
  }
  await db.prepare(`UPDATE auth_attempts SET count=count+1 WHERE bucket=?`).bind(bucket).run();
  return { allowed: true, retryAfterMs: 0 };
}
