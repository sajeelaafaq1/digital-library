import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";

// ESM replacements
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// paths
const DB_PATH = path.join(__dirname, "data", "library.db");
const DATA_FILE = path.join(__dirname, "data.txt");
const COVERS_DIR = path.join(__dirname, "public", "covers");

// sqlite
const db = new sqlite3.Database(DB_PATH);

// helpers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function sanitize(value) {
  if (value == null) return null;
  return value.replace(/["`]/g, "").trim();
}

(async () => {
  try {
    const file = fs.readFileSync(DATA_FILE, "utf8");

    const records = parse(file, {
      delimiter: "\t",
      trim: true,
      relax_quotes: true,
    });

    // remove header
    records.shift();

    await run("BEGIN TRANSACTION");

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2; // +1 header, +1 index
      const row = records[i].map(sanitize);

      const [
        title,
        shelfId,
        rackOrder,
        position,
        cover,
        omnibus,
        a1fn, a1ln,
        a2fn, a2ln,
        a3fn, a3ln,
        a4fn, a4ln
      ] = row;

      if (!title || !shelfId || !rackOrder || !position) {
        console.warn(`⚠️  Row ${rowNumber}: Missing required fields, skipped`);
        continue;
      }

      // get rack_id
      const rack = await get(
        `SELECT id FROM rack WHERE shelf_id = ? AND rack_order = ?`,
        [shelfId, rackOrder]
      );

      if (!rack) {
        console.warn(`⚠️  Row ${rowNumber}: Rack not found (shelf=${shelfId}, order=${rackOrder})`);
        continue;
      }

      // duplicate book check
      const existingBook = await get(
        `SELECT id FROM book WHERE title = ? AND rack_id = ?`,
        [title, rack.id]
      );

      if (existingBook) {
        console.warn(`⚠️  Row ${rowNumber}: Duplicate book "${title}", skipped`);
        continue;
      }

      // position conflict check
      const positionConflict = await get(
        `SELECT id FROM book WHERE rack_id = ? AND position = ?`,
        [rack.id, position]
      );

      if (positionConflict) {
        console.warn(`⚠️  Row ${rowNumber}: Position conflict at rack ${rack.id}, position ${position}`);
        continue;
      }

      // insert book
      const bookRes = await run(
        `
        INSERT INTO book (title, rack_id, position)
        VALUES (?, ?, ?)
        `,
        [title, rack.id, position]
      );

      const bookId = bookRes.lastID;

      // authors
      const authors = [
        [a1fn, a1ln],
        [a2fn, a2ln],
        [a3fn, a3ln],
        [a4fn, a4ln],
      ];

      let authorOrder = 1;

      for (const [firstName, lastName] of authors) {
        if (!lastName) continue;

        await run(
          `
          INSERT INTO author (first_name, last_name)
          VALUES (?, ?)
          ON CONFLICT(first_name, last_name) DO NOTHING
          `,
          [firstName || null, lastName]
        );

        const author = await get(
          `
          SELECT id FROM author
          WHERE first_name IS ? AND last_name = ?
          `,
          [firstName || null, lastName]
        );

        await run(
          `
          INSERT INTO book_author (book_id, author_id, author_order)
          VALUES (?, ?, ?)
          `,
          [bookId, author.id, authorOrder]
        );

        authorOrder++;
      }

      // cover handling (.jpg assumed)
      if (cover && cover !== "-1") {
        const oldPath = path.join(COVERS_DIR, `${cover}-L.jpg`);
        const newPath = path.join(COVERS_DIR, `${bookId}.jpg`);

        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
        } else {
          console.warn(`⚠️  Row ${rowNumber}: Cover not found (${oldPath})`);
        }
      }
    }

    await run("COMMIT");
    console.log("✅ Import completed successfully");

  } catch (err) {
    await run("ROLLBACK");
    console.error("❌ Import failed:", err);
  } finally {
    db.close();
  }
})();
