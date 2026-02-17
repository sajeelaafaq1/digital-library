import express from "express";
import db from "../db.js";
import { libraryCache } from "../utils/cache.js";

const router = express.Router();

router.get("/", (req, res) => {
  const now = Date.now();

  // ---- CACHE HIT ----
  if (libraryCache.data && libraryCache.expiresAt > now) {
    return res.json(libraryCache.data);
  }

  const sql = `
    SELECT
      s.id AS shelf_id,
      s.name AS shelf_name,
      s.is_reserved AS shelf_reserved,
      s.rack_capacity,

      r.id AS rack_id,
      r.rack_order,
      r.name AS rack_name,
      r.is_reserved AS rack_reserved,
      r.is_full AS rack_full,

      b.id AS book_id,
      b.title,
      b.position,
      b.is_fixed,
      b.stack_level,
      b.orientation,

      a.first_name,
      a.last_name,
      ba.author_order
    FROM shelf s
    LEFT JOIN rack r ON r.shelf_id = s.id
    LEFT JOIN book b ON b.rack_id = r.id
    LEFT JOIN book_author ba ON ba.book_id = b.id
    LEFT JOIN author a ON a.id = ba.author_id
    ORDER BY
      s.id,
      r.rack_order,
      b.position,
      ba.author_order
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const shelvesMap = new Map();

    for (const row of rows) {
      // ---- Shelf ----
      if (!shelvesMap.has(row.shelf_id)) {
        shelvesMap.set(row.shelf_id, {
          shelfId: row.shelf_id,
          shelfName: row.shelf_name,
          isReservedShelf: !!row.shelf_reserved,
          rackCount: row.rack_capacity,
          racks: new Map()
        });
      }

      const shelf = shelvesMap.get(row.shelf_id);

      // ---- Rack ----
      if (row.rack_id && !shelf.racks.has(row.rack_id)) {
        shelf.racks.set(row.rack_id, {
          rackId: row.rack_id,
          rackOrder: row.rack_order,
          rackName: row.rack_name,
          isReservedRack: !!row.rack_reserved,
          isRackFull: !!row.rack_full,
          books: new Map()
        });
      }

      const rack = shelf.racks.get(row.rack_id);
      if (!rack || !row.book_id) continue;

      // ---- Book ----
      if (!rack.books.has(row.book_id)) {
        rack.books.set(row.book_id, {
          title: row.title,
          author: null,
          additionalAuthors: [],
          coverImage: `/covers/${row.book_id}.jpg`,
          position: row.position,
          isFixedPosition: !!row.is_fixed,
          isStacked: row.orientation === "horizontal",
          stackCount: row.stack_level
        });
      }

      const book = rack.books.get(row.book_id);

      // ---- Authors ----
      if (row.last_name) {
        const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ");
        if (row.author_order === 1) {
          book.author = fullName;
        } else {
          book.additionalAuthors.push(fullName);
        }
      }
    }

    // ---- Finalize structure ----
    const shelves = Array.from(shelvesMap.values()).map(shelf => ({
      shelfId: shelf.shelfId,
      shelfName: shelf.shelfName,
      isReservedShelf: shelf.isReservedShelf,
      rackCount: shelf.rackCount,
      racks: Array.from(shelf.racks.values()).map(rack => ({
        ...rack,
        books: Array.from(rack.books.values())
      }))
    }));

    const response = { shelves };

    // ---- STORE CACHE ----
    libraryCache.data = response;
    libraryCache.expiresAt = now + libraryCache.ttlMs;

    res.json(response);
  });
});

export default router;