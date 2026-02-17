import express from "express";
import db from "../db.js";
import { invalidateLibraryCache } from "../utils/cache.js";

const router = express.Router();

router.post("/", (req, res) => {
  const { first_name, last_name } = req.body;

  db.run(
    `INSERT INTO author (first_name, last_name)
     VALUES (?, ?)`,
    [first_name, last_name],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ id: this.lastID });
      invalidateLibraryCache();
    }
  );
});

router.get("/", (req, res) => {
  db.all(`SELECT * FROM author`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Book ↔ Author
router.post("/add-book", (req, res) => {
  const { book_id, author_id, author_order = 1 } = req.body;

  db.run(
    `INSERT INTO book_author (book_id, author_id, author_order)
     VALUES (?, ?, ?)`,
    [book_id, author_id, author_order],
    function (err) {
      if (err) return res.status(400).json({ error: err.message });
      res.json({ success: true });
      invalidateLibraryCache();
    }
  );
});

export default router;