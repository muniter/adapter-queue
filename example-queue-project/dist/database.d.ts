import sqlite3 from 'sqlite3';
declare const db: sqlite3.Database;
export declare const run: (arg1: string) => Promise<unknown>;
export declare const get: (arg1: string) => Promise<unknown>;
export declare const all: (arg1: string) => Promise<unknown>;
export declare function initializeDatabase(): Promise<void>;
export { db };
//# sourceMappingURL=database.d.ts.map