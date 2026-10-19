// A minimal D1-compatible wrapper around node:sqlite so the Worker can be tested in plain Node.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

class Stmt {
  db: DatabaseSync;
  sql: string;
  args: any[] = [];
  constructor(db: DatabaseSync, sql: string) {
    this.db = db;
    this.sql = sql;
  }
  bind(...args: any[]) {
    const s = new Stmt(this.db, this.sql);
    s.args = args.map((a) => (a === undefined ? null : a));
    return s;
  }
  async first<T = any>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args);
    return (row as T) ?? null;
  }
  async all<T = any>() {
    const results = this.db.prepare(this.sql).all(...this.args) as T[];
    return { results, success: true, meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  }
  runSync() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  }
}

export class D1Shim {
  db: DatabaseSync;
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON");
    const dir = new URL("../migrations/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      this.db.exec(readFileSync(new URL(f, dir), "utf8"));
    }
  }
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    const out: any[] = [];
    this.db.exec("BEGIN");
    try {
      for (const s of stmts) out.push(s.runSync());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }
}
