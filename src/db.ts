import { Pool, types } from 'pg';

// COUNT(*)/SUM come back from pg as int8/numeric strings; the app expects numbers.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/**
 * Database handle passed around the app (was a D1Database binding).
 * Queries keep D1/SQLite-style `?` placeholders; they are rewritten to $n here.
 */
export class Db {
  constructor(private pool: Pool) {}
  query(sql: string, params: unknown[]) {
    return this.pool.query(toPg(sql), params as unknown[] as any[]);
  }
  close() {
    return this.pool.end();
  }
}

const pgSqlCache = new Map<string, string>();

/** Rewrite `?`/`?N` placeholders to `$n`, leaving single-quoted literals alone. */
function toPg(sql: string): string {
  const cached = pgSqlCache.get(sql);
  if (cached) return cached;
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // Copy the string literal verbatim ('' is an escaped quote).
      out += ch;
      while (++i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") out += sql[++i];
          else break;
        }
      }
    } else if (ch === '?') {
      let digits = '';
      while (/[0-9]/.test(sql[i + 1] ?? '')) digits += sql[++i];
      if (digits) {
        out += `$${digits}`;
        n = Math.max(n, Number(digits)); // SQLite: bare ? continues after the highest ?N
      } else {
        out += `$${++n}`;
      }
    } else {
      out += ch;
    }
  }
  pgSqlCache.set(sql, out);
  return out;
}

type Row = Record<string, unknown>;

/** Tables that carry created_at/updated_at maintained by this layer. */
const TIMESTAMPED = new Set(['users', 'vendors', 'routines', 'visits', 'tasks', 'recommendations']);
/** Tables whose mutations are recorded in audit_log. */
const AUDITED = new Set(['users', 'vendors', 'routines', 'visits', 'tasks', 'recommendations', 'visit_reports', 'visit_comments', 'system_config']);

const bindable = (v: unknown) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v);

export async function all<T>(db: Db, sql: string, ...params: unknown[]): Promise<T[]> {
  const { rows } = await db.query(sql, params.map(bindable));
  return rows as T[];
}

export async function first<T>(db: Db, sql: string, ...params: unknown[]): Promise<T | null> {
  const { rows } = await db.query(sql, params.map(bindable));
  return (rows[0] as T) ?? null;
}

export async function run(db: Db, sql: string, ...params: unknown[]) {
  return db.query(sql, params.map(bindable));
}

async function audit(
  db: Db,
  table: string,
  recordId: string | null,
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  actorId: string | null,
  oldData: Row | null,
  newData: Row | null
) {
  if (!AUDITED.has(table)) return;
  const strip = (r: Row | null) => {
    if (!r) return null;
    const { password_hash: _omit, ...rest } = r;
    return JSON.stringify(rest);
  };
  await run(
    db,
    'INSERT INTO audit_log (table_name, record_id, action, actor_id, old_data, new_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    table, recordId, action, actorId, strip(oldData), strip(newData), now()
  );
}

/** Insert a row (id/timestamps filled in when absent) and audit it. Returns the stored row. */
export async function insertRow<T = Row>(db: Db, table: string, row: Row, actorId: string | null): Promise<T> {
  const full: Row = { id: uid(), ...row };
  if (TIMESTAMPED.has(table)) {
    full.created_at = full.created_at ?? now();
    full.updated_at = full.updated_at ?? now();
  }
  const cols = Object.keys(full);
  await run(
    db,
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...cols.map((c) => full[c])
  );
  await audit(db, table, String(full.id), 'INSERT', actorId, null, full);
  return full as unknown as T;
}

/** Update a row by id and audit old/new. Throws if the row does not exist. */
export async function updateRow<T = Row>(db: Db, table: string, id: string, patch: Row, actorId: string | null): Promise<T> {
  const old = await first<Row>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!old) throw new Error(`${table} row not found`);
  const changes: Row = { ...patch };
  if (TIMESTAMPED.has(table)) changes.updated_at = now();
  const cols = Object.keys(changes);
  await run(
    db,
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...cols.map((c) => changes[c]), id
  );
  const updated = { ...old, ...changes };
  await audit(db, table, id, 'UPDATE', actorId, old, updated);
  return updated as unknown as T;
}

/** Delete a row by id and audit it. No-op if the row does not exist. */
export async function deleteRow(db: Db, table: string, id: string, actorId: string | null) {
  const old = await first<Row>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!old) return;
  await run(db, `DELETE FROM ${table} WHERE id = ?`, id);
  await audit(db, table, id, 'DELETE', actorId, old, null);
}
