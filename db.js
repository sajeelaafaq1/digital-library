import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "library.db");
const db = new sqlite3.Database(dbPath);


// ---------- DB INIT ----------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS shelf (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_reserved BOOLEAN DEFAULT FALSE,
      rack_capacity INTEGER NOT NULL DEFAULT 1
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS rack (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rack_order INTEGER NOT NULL,
      shelf_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_full BOOLEAN NOT NULL DEFAULT FALSE,
      is_reserved BOOLEAN NOT NULL DEFAULT FALSE,
      FOREIGN KEY (shelf_id) REFERENCES shelf(id),
      UNIQUE (shelf_id, name)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS book (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER,
      isbn TEXT,
      isbn3 TEXT,
      rack_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      orientation TEXT CHECK (orientation IN ('vertical', 'horizontal')) NOT NULL DEFAULT 'vertical',
      stack_level INTEGER DEFAULT 0,
      is_fixed BOOLEAN DEFAULT FALSE,
      notes TEXT,
      FOREIGN KEY (rack_id) REFERENCES rack(id),
      UNIQUE (rack_id, position)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS author (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT,
      last_name TEXT NOT NULL,
      UNIQUE(first_name, last_name)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS book_author (
      book_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      author_order INTEGER DEFAULT 1,
      PRIMARY KEY (book_id, author_id),
      FOREIGN KEY (book_id) REFERENCES book(id),
      FOREIGN KEY (author_id) REFERENCES author(id)
    );
  `);
});

export default db;
