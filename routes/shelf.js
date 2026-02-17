import express from "express";
import db from "../db.js";
import { run } from "../utils/sqlite.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();


router.post("/", (req, res) => {
  const shelves = req.body;

  if (!Array.isArray(shelves) || shelves.length === 0) {
    return res.status(400).json({ error: "Invalid shelves payload" });
  }

  const createdShelves = [];

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const insertShelf = db.prepare(
      `INSERT INTO shelf (name, is_reserved, rack_capacity)
       VALUES (?, ?, ?)`
    );

    const insertRack = db.prepare(
      `INSERT INTO rack (rack_order, shelf_id, name, is_full, is_reserved)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const shelf of shelves) {
      const { name, rackCapacity = 1 } = shelf;

      insertShelf.run(name, false, rackCapacity, function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: err.message });
        }

        const shelfId = this.lastID;

        for (let i = 1; i <= rackCapacity; i++) {
          insertRack.run(
            i,
            shelfId,
            `Rack ${i}`,
            false,
            false
          );
        }

        createdShelves.push({
          shelf_id: shelfId,
          rack_count: rackCapacity
        });
      });
    }

    insertShelf.finalize(err => {
      if (err) {
        db.run("ROLLBACK");
        return res.status(400).json({ error: err.message });
      }

      insertRack.finalize(err => {
        if (err) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: err.message });
        }

        db.run("COMMIT");
        invalidateLibraryCache();

        res.json({
          shelves_created: createdShelves.length,
          shelves: createdShelves
        });
      });
    });
  });
});

router.put("/:id/rack-count", (req, res) => {
  const shelfId = req.params.id;
  const { rack_count } = req.body;

  if (!Number.isInteger(rack_count) || rack_count < 1) {
    return res.status(400).json({ error: "Invalid rack_count" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // 1️⃣ Get current rack_count from shelf
    db.get(
      `SELECT rack_capacity FROM shelf WHERE id = ?`,
      [shelfId],
      (err, shelf) => {
        if (err) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: err.message });
        }

        if (!shelf) {
          db.run("ROLLBACK");
          return res.status(404).json({ error: "Shelf not found" });
        }

        const currentCount = shelf.rack_capacity;

        // 2️⃣ Update rack_count on shelf
        db.run(
          `UPDATE shelf SET rack_capacity = ? WHERE id = ?`,
          [rack_count, shelfId],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(400).json({ error: err.message });
            }

            // 3️⃣ Only expand racks if increased
            if (rack_count <= currentCount) {
              db.run("COMMIT");
              invalidateLibraryCache();
              return res.json({
                updated: true,
                racks_added: 0
              });
            }

            const stmt = db.prepare(
              `INSERT INTO rack (rack_order, shelf_id, name, is_full, is_reserved)
               VALUES (?, ?, ?, ?, ?)`
            );

            for (let i = currentCount + 1; i <= rack_count; i++) {
              stmt.run(
                i,
                shelfId,
                `Rack ${i}`,
                false,
                false
              );
            }

            stmt.finalize(err => {
              if (err) {
                db.run("ROLLBACK");
                return res.status(400).json({ error: err.message });
              }

              db.run("COMMIT");
              invalidateLibraryCache();

              res.json({
                updated: true,
                racks_added: rack_count - currentCount
              });
            });
          }
        );
      }
    );
  });
});

router.get("/", (req, res) => {
  db.all(`SELECT * FROM shelf`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.put("/:id", (req, res) => {
  const { name } = req.body;

  db.run(
    `UPDATE shelf SET name = ? WHERE id = ?`,
    [name, req.params.id],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });

      if (this.changes === 0) {
        return res.status(404).json({ error: "Shelf not found" });
      }

      invalidateLibraryCache();
      res.json({ updated: true });
    }
  );
});

router.patch("/:id/reserved", async (req, res) => {
  await run(db, `
    UPDATE shelf SET is_reserved = NOT is_reserved WHERE id = ?
  `, [req.params.id]);
  res.sendStatus(200);
  invalidateLibraryCache();
});

export default router;