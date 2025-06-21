import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new sqlite3.Database(path.join(__dirname, '../queue.db'));
export const run = promisify(db.run.bind(db));
export const get = promisify(db.get.bind(db));
export const all = promisify(db.all.bind(db));
export async function initializeDatabase() {
    await run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name TEXT NOT NULL DEFAULT 'default',
      payload BLOB NOT NULL,
      ttr INTEGER DEFAULT 300,
      delay INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      push_time INTEGER NOT NULL,
      delay_time INTEGER,
      reserve_time INTEGER,
      expire_time INTEGER,
      done_time INTEGER,
      attempt INTEGER DEFAULT 0,
      status TEXT DEFAULT 'waiting'
    )
  `);
    await run(`
    CREATE INDEX IF NOT EXISTS idx_status_delay ON jobs(status, delay_time);
  `);
    await run(`
    CREATE INDEX IF NOT EXISTS idx_priority_push ON jobs(priority DESC, push_time ASC);
  `);
    console.log('Database initialized successfully');
}
export { db };
//# sourceMappingURL=database.js.map