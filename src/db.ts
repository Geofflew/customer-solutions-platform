import { readFileSync } from 'node:fs'
import pg from 'pg'

// .env is optional: DATABASE_URL may come from the shell instead.
try {
  process.loadEnvFile()
} catch {}

// Dates stay 'YYYY-MM-DD' strings and counts stay numbers, so output never depends on the
// machine's time zone.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(20, Number)
pg.types.setTypeParser(1700, Number)

/** The platform's fixed "today". Every mechanism takes a date argument instead of reading the clock. */
export const AS_OF = '2026-03-18'

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://127.0.0.1:5432/acme_solutions'

export type Db = pg.Pool | pg.PoolClient

export function connect(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URL, max: 4, options: '-c TimeZone=UTC' })
}

/** Drop and recreate the schema. */
export async function setup(db: Db): Promise<void> {
  await db.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
}

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[]
}

/** Date arithmetic on 'YYYY-MM-DD' strings, in UTC. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
