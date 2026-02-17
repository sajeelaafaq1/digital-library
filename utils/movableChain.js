import { all, run } from "./sqlite.js";

export async function getMovableChain(db) {
  const rows = await all(db, `
    SELECT
      b.id as book_id,
      b.position,
      b.rack_id,
      r.rack_order,
      r.is_full,
      r.is_reserved as rack_reserved,
      s.id as shelf_id,
      s.is_reserved as shelf_reserved,
      b.is_fixed
    FROM book b
    JOIN rack r ON b.rack_id = r.id
    JOIN shelf s ON r.shelf_id = s.id
    ORDER BY
      s.id,
      r.rack_order,
      b.position
  `);

  return rows.filter(r =>
    !r.is_fixed &&
    !r.rack_reserved &&
    !r.shelf_reserved
  );
}

export async function displaceAndCreateHole(db, chain, insertRackId, insertPosition) {
  const insertIndex = chain.findIndex(r =>
    r.rack_id === insertRackId &&
    r.position >= insertPosition
  );

  if (insertIndex === -1) {
    throw new Error("Invalid insert position");
  }

  let absorbIndex = -1;

  for (let i = chain.length - 1; i >= insertIndex; i--) {
    if (!chain[i].is_full) {
      absorbIndex = i;
      break;
    }
  }

  if (absorbIndex === -1) {
    throw new Error("No rack can absorb additional book");
  }

  for (let i = absorbIndex; i > insertIndex; i--) {
    const from = chain[i - 1];
    const to = chain[i];

    await run(db, `
      UPDATE book
      SET rack_id = ?, position = ?
      WHERE id = ?
    `, [to.rack_id, to.position, from.book_id]);
  }

  return chain[insertIndex]; // hole location
}