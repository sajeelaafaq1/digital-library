import express from "express";
import db from "../db.js";
import { run } from "../utils/sqlite.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();

router.post("/", (req, res) => {
  const racks = req.body;

  if (!Array.isArray(racks) || racks.length === 0) {
    return res.status(400).json({ error: "Invalid racks payload" });
  }

  const createdRackIds = [];

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const insertRackStmt = db.prepare(`
      INSERT INTO rack (rack_order, shelf_id, name, is_full, is_reserved)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateShelfStmt = db.prepare(`
      UPDATE shelf
      SET rack_capacity = rack_capacity + 1
      WHERE id = ?
    `);

    let pending = racks.length;
    let hasError = false;

    for (const rack of racks) {
      const {
        shelf_id,
        name,
        is_full = false,
        is_reserved = false
      } = rack;

      // Get next rack_order for this shelf
      db.get(
        `
        SELECT COALESCE(MAX(rack_order), 0) + 1 AS nextOrder
        FROM rack
        WHERE shelf_id = ?
        `,
        [shelf_id],
        (err, row) => {
          if (err || hasError) {
            hasError = true;
            db.run("ROLLBACK");
            return res.status(400).json({ error: err?.message });
          }

          insertRackStmt.run(
            row.nextOrder,
            shelf_id,
            name,
            is_full,
            is_reserved,
            function (err) {
              if (err || hasError) {
                hasError = true;
                db.run("ROLLBACK");
                return res.status(400).json({ error: err?.message });
              }

              createdRackIds.push(this.lastID);

              updateShelfStmt.run(shelf_id, err => {
                if (err || hasError) {
                  hasError = true;
                  db.run("ROLLBACK");
                  return res.status(400).json({ error: err?.message });
                }

                pending--;

                if (pending === 0) {
                  insertRackStmt.finalize();
                  updateShelfStmt.finalize();

                  db.run("COMMIT", err => {
                    if (err) {
                      return res.status(500).json({ error: err.message });
                    }

                    invalidateLibraryCache();

                    res.json({
                      racks_created: createdRackIds.length,
                      rack_ids: createdRackIds
                    });
                  });
                }
              });
            }
          );
        }
      );
    }
  });
});

router.post("/insert", (req, res) => {
  const { shelf_id, rack_order, name, is_full = false, is_reserved = false } = req.body;

  if (!shelf_id || !rack_order || !name) {
    return res.status(400).json({ error: "shelf_id, rack_order and name are required" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    // 1️⃣ Shift all racks >= rack_order down by 1
    db.run(
      `
      UPDATE rack
      SET rack_order = rack_order + 1
      WHERE shelf_id = ?
        AND rack_order >= ?
      `,
      [shelf_id, rack_order],
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(400).json({ error: err.message });
        }

        // 2️⃣ Insert new rack at desired position
        db.run(
          `
          INSERT INTO rack (rack_order, shelf_id, name, is_full, is_reserved)
          VALUES (?, ?, ?, ?, ?)
          `,
          [rack_order, shelf_id, name, is_full, is_reserved],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(400).json({ error: err.message });
            }

            const newRackId = this.lastID;

            // 3️⃣ Increment shelf capacity
            db.run(
              `
              UPDATE shelf
              SET rack_capacity = rack_capacity + 1
              WHERE id = ?
              `,
              [shelf_id],
              err => {
                if (err) {
                  db.run("ROLLBACK");
                  return res.status(400).json({ error: err.message });
                }

                db.run("COMMIT", err => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  invalidateLibraryCache();

                  res.json({
                    rack_id: newRackId,
                    inserted_at: rack_order
                  });
                });
              }
            );
          }
        );
      }
    );
  });
});

router.get("/", (req, res) => {
  const { shelf_id } = req.query;

  const sql = shelf_id
    ? `SELECT * FROM rack WHERE shelf_id = ?`
    : `SELECT * FROM rack`;

  db.all(sql, shelf_id ? [shelf_id] : [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.put("/:id", (req, res) => {
  const { name } = req.body;

  db.run(
    `UPDATE rack SET name = ? WHERE id = ?`,
    [name, req.params.id],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });

      if (this.changes === 0) {
        return res.status(404).json({ error: "Rack not found" });
      }

      invalidateLibraryCache();
      res.json({ updated: true });
    }
  );
});

router.patch("/:id/full", async (req, res) => {
  await run(db, `
    UPDATE rack SET is_full = NOT is_full WHERE id = ?
  `, [req.params.id]);
  res.sendStatus(200);
  invalidateLibraryCache();
});

router.patch("/:id/reserved", async (req, res) => {
  await run(db, `
    UPDATE rack SET is_reserved = NOT is_reserved WHERE id = ?
  `, [req.params.id]);
  res.sendStatus(200);
  invalidateLibraryCache();
});

export default router;