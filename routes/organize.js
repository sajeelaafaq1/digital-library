import express from "express";
import db from "../db.js";
import { run, all, get } from "../utils/sqlite.js";
import { getMovableChain, displaceAndCreateHole } from "../utils/movableChain.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();

router.post("/insert", async (req, res) => {
  const { books } = req.body;

  if (!Array.isArray(books) || books.length === 0) {
    return res.status(400).json({ error: "books must be a non-empty array" });
  }

  const insertedBookIds = [];

  try {
    await run(db, "BEGIN TRANSACTION");

    for (const entry of books) {
      const { book, authors } = entry;

      const chain = await getMovableChain(db);

      const holeSpot = await displaceAndCreateHole(
        db,
        chain,
        book.rack_id,
        book.position
      );

      const result = await run(db, `
        INSERT INTO book
        (title, year, isbn, isbn3, rack_id, position, orientation, stack_level, is_fixed, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        book.title,
        book.year,
        book.isbn,
        book.isbn3,
        holeSpot.rack_id,
        holeSpot.position,
        book.orientation || "vertical",
        book.stack_level || 0,
        book.is_fixed || false,
        book.notes
      ]);

      const bookId = result.lastID;
      insertedBookIds.push(bookId);

      // Authors
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

    res.json({ book_ids: insertedBookIds });
  } catch (err) {
    await run(db, "ROLLBACK");
    invalidateLibraryCache();
    res.status(400).json({ error: err.message });
  }
});

router.post("/move-range", async (req, res) => {
  const { source, target } = req.body;

  try {
    await run(db, "BEGIN TRANSACTION");

    const books = await all(db, `
      SELECT * FROM book
      WHERE rack_id = ?
        AND position BETWEEN ? AND ?
      ORDER BY position
    `, [
      source.rack_id,
      source.start_position,
      source.start_position + source.count - 1
    ]);

    if (books.length !== source.count) {
      throw new Error("Invalid source range");
    }

    // Remove books temporarily
    const bookIds = books.map(b => b.id);

    await run(db, `
      DELETE FROM book
      WHERE id IN (${bookIds.map(() => "?").join(",")})
    `, bookIds);

    // Reinsert one by one (keeps order)
    for (let i = 0; i < books.length; i++) {
      const b = books[i];

      const chain = await getMovableChain(db);
      const hole = await displaceAndCreateHole(
        db,
        chain,
        target.rack_id,
        target.position + i
      );

      await run(db, `
        INSERT INTO book
        (id, title, year, isbn, isbn3, rack_id, position,
         orientation, stack_level, is_fixed, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        b.id,
        b.title,
        b.year,
        b.isbn,
        b.isbn3,
        hole.rack_id,
        hole.position,
        b.orientation,
        b.stack_level,
        b.is_fixed,
        b.notes
      ]);
    }

    await run(db, "COMMIT");
    res.sendStatus(200);

  } catch (err) {
    await run(db, "ROLLBACK");
    res.status(400).json({ error: err.message });
  }
});

router.post("/move", async (req, res) => {
  const { moves } = req.body;

  try {
    await run(db, "BEGIN TRANSACTION");

    for (const move of moves) {
      const book = await get(db, `
        SELECT * FROM book WHERE id = ?
      `, [move.book_id]);

      if (!book) throw new Error("Book not found");

      // Remove book temporarily
      await run(db, `
        DELETE FROM book WHERE id = ?
      `, [book.id]);

      const chain = await getMovableChain(db);

      const hole = await displaceAndCreateHole(
        db,
        chain,
        move.rack_id,
        move.position
      );

      await run(db, `
        INSERT INTO book
        (id, title, year, isbn, isbn3, rack_id, position,
         orientation, stack_level, is_fixed, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        book.id,
        book.title,
        book.year,
        book.isbn,
        book.isbn3,
        hole.rack_id,
        hole.position,
        book.orientation,
        book.stack_level,
        book.is_fixed,
        book.notes
      ]);
    }

    await run(db, "COMMIT");
    res.sendStatus(200);

  } catch (err) {
    await run(db, "ROLLBACK");
    res.status(400).json({ error: err.message });
  }
});

router.post("/swap", async (req, res) => {
  const { source, target } = req.body;

  try {
    await run(db, "BEGIN TRANSACTION");

    const sourceBooks = await all(db, `
      SELECT id, position
      FROM book
      WHERE rack_id = ?
        AND position BETWEEN ? AND ?
      ORDER BY position
    `, [
      source.rack_id,
      source.start_position,
      source.start_position + source.count - 1
    ]);

    const targetBooks = await all(db, `
      SELECT id, position
      FROM book
      WHERE rack_id = ?
        AND position BETWEEN ? AND ?
      ORDER BY position
    `, [
      target.rack_id,
      target.start_position,
      target.start_position + source.count - 1
    ]);

    if (
      sourceBooks.length !== source.count ||
      targetBooks.length !== source.count
    ) {
      throw new Error("Invalid swap range");
    }

    // Swap positions
    for (let i = 0; i < source.count; i++) {
      await run(db, `
        UPDATE book SET rack_id = ?, position = ?
        WHERE id = ?
      `, [target.rack_id, target.start_position + i, sourceBooks[i].id]);

      await run(db, `
        UPDATE book SET rack_id = ?, position = ?
        WHERE id = ?
      `, [source.rack_id, source.start_position + i, targetBooks[i].id]);
    }

    await run(db, "COMMIT");
    res.sendStatus(200);

  } catch (err) {
    await run(db, "ROLLBACK");
    res.status(400).json({ error: err.message });
  }
});

export default router;