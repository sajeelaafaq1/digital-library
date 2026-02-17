import express from "express";
import db from "../db.js";
import { run } from "../utils/sqlite.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();

router.post("/", (req, res) => {
  const {
    title,
    year,
    isbn,
    isbn3,
    rack_id,
    position,
    orientation = "vertical",
    stack_level = 0,
    is_fixed = false,
    notes
  } = req.body;

  db.run(
    `INSERT INTO book
     (title, year, isbn, isbn3, rack_id, position, orientation, stack_level, is_fixed, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      year,
      isbn,
      isbn3,
      rack_id,
      position,
      orientation,
      stack_level,
      is_fixed,
      notes
    ],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID });
      invalidateLibraryCache();
    }
  );
});

router.get("/", (req, res) => {
  db.all(`SELECT * FROM book`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get("/:id", (req, res) => {
  const bookId = req.params.id;

  db.get(
    `
    SELECT
      b.*,
      r.name AS rack_name,
      s.name AS shelf_name
    FROM book b
    JOIN rack r ON b.rack_id = r.id
    JOIN shelf s ON r.shelf_id = s.id
    WHERE b.id = ?
    `,
    [bookId],
    (err, book) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!book) return res.status(404).json({ error: "Book not found" });

      db.all(
        `
        SELECT a.*, ba.author_order
        FROM author a
        JOIN book_author ba ON ba.author_id = a.id
        WHERE ba.book_id = ?
        ORDER BY ba.author_order
        `,
        [bookId],
        (err, authors) => {
          if (err) return res.status(500).json({ error: err.message });
          book.authors = authors;
          res.json(book);
        }
      );
    }
  );
});

router.patch("/:id", async (req, res) => {
  const bookId = req.params.id;
  const { book, authors } = req.body;

  try {
    await run(db, "BEGIN TRANSACTION");

    /* ------------------ BOOK UPDATE (PARTIAL) ------------------ */
    if (book && Object.keys(book).length > 0) {
      const allowedFields = [
        "title",
        "year",
        "isbn",
        "isbn3",
        "orientation",
        "stack_level",
        "is_fixed",
        "notes"
      ];

      const updates = [];
      const values = [];

      for (const field of allowedFields) {
        if (book[field] !== undefined) {
          updates.push(`${field} = ?`);
          values.push(book[field]);
        }
      }

      if (updates.length > 0) {
        await run(db, `
          UPDATE book
          SET ${updates.join(", ")}
          WHERE id = ?
        `, [...values, bookId]);
      }
    }

    /* ------------------ AUTHORS (OPTIONAL) ------------------ */
    if (authors !== undefined) {
      // Replace strategy, but ONLY if authors was sent
      await run(db, `
        DELETE FROM book_author
        WHERE book_id = ?
      `, [bookId]);

      for (let i = 0; i < authors.length; i++) {
        const a = authors[i];
        let authorId = a.id;

        if (!authorId) {
          await run(db, `
            INSERT OR IGNORE INTO author (first_name, last_name)
            VALUES (?, ?)
          `, [a.first_name, a.last_name]);

          const row = await get(db, `
            SELECT id FROM author
            WHERE first_name IS ? AND last_name = ?
          `, [a.first_name || null, a.last_name]);

          authorId = row.id;
        }

        await run(db, `
          INSERT INTO book_author (book_id, author_id, author_order)
          VALUES (?, ?, ?)
        `, [bookId, authorId, a.author_order || i + 1]);
      }
    }

    await run(db, "COMMIT");
    invalidateLibraryCache();

    res.json({ success: true });
  } catch (err) {
    await run(db, "ROLLBACK");
    invalidateLibraryCache();
    res.status(400).json({ error: err.message });
  }
});

router.patch("/:id/fixed", async (req, res) => {
  await run(db, `
    UPDATE book SET is_fixed = NOT is_fixed WHERE id = ?
  `, [req.params.id]);
  res.sendStatus(200);
  invalidateLibraryCache();
});

export default router;