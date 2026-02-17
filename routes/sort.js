import express from "express";
import db from "../db.js";
import { run, all } from "../utils/sqlite.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();

router.post("/auto-alphabetize", async (req, res) => {
  const { start, end } = req.body;

  try {
    await run(db, "BEGIN TRANSACTION");

    const rows = await all(db, `
      SELECT
        b.id AS book_id,
        b.title,
        b.position,
        b.rack_id,
        r.rack_order,
        r.is_full,
        r.is_reserved AS rack_reserved,
        s.id AS shelf_id,
        s.is_reserved AS shelf_reserved,
        b.is_fixed,
        a.last_name AS author_last
      FROM book b
      JOIN rack r ON b.rack_id = r.id
      JOIN shelf s ON r.shelf_id = s.id
      LEFT JOIN book_author ba
        ON ba.book_id = b.id AND ba.author_order = 1
      LEFT JOIN author a ON a.id = ba.author_id
      ORDER BY
        s.id,
        r.rack_order,
        b.position
    `);

    const rangeBooks = rows.filter(b => inRange(b, start, end));

    const fullyReserved = rangeBooks.every(b =>
      b.rack_reserved || b.shelf_reserved
    );

    const movable = rangeBooks.filter(b => {
      if (b.is_fixed) return false;

      // If fully inside reserved area, allow sorting
      if (fullyReserved) return true;

      // Otherwise, reserved blocks movement
      return !b.rack_reserved && !b.shelf_reserved;
    });

    movable.sort((a, b) => {
      const aAuth = a.author_last || "";
      const bAuth = b.author_last || "";
      const c = aAuth.localeCompare(bAuth);
      return c !== 0 ? c : a.title.localeCompare(b.title);
    });

    const slots = rangeBooks
      .filter(b =>
        !b.is_fixed &&
        !b.rack_reserved &&
        !b.shelf_reserved
      )
      .map(b => ({
        rack_id: b.rack_id,
        position: b.position
      }));

    if (slots.length !== movable.length) {
      throw new Error("Cannot safely alphabetize this range");
    }

    for (let i = 0; i < movable.length; i++) {
      await run(db, `
        UPDATE book
        SET rack_id = ?, position = ?
        WHERE id = ?
      `, [
        slots[i].rack_id,
        slots[i].position,
        movable[i].book_id
      ]);
    }

    await run(db, "COMMIT");
    res.sendStatus(200);
    invalidateLibraryCache();

  } catch (err) {
    await run(db, "ROLLBACK");
    res.status(400).json({ error: err.message });
    invalidateLibraryCache();
  }
});

export default router;