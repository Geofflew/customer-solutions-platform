/** Score every account for the last 12 weeks and store the breakdowns (cs.activation_scores). */
import { pathToFileURL } from 'node:url'
import { AS_OF, connect, type Db } from '../src/db.ts'
import { writeScores } from '../src/load.ts'
import { weekDates } from '../src/status.ts'

export const WEEKS = weekDates(AS_OF, 12)
export const scores = (db: Db) => writeScores(db, WEEKS)

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const db = connect()
  await scores(db)
  await db.end()
  console.log('scored')
}
