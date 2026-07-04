const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /v1/queue/:location_id/join
router.post('/:location_id/join', async (req, res) => {
  const { location_id } = req.params;
  const { guest_name } = req.body;

  if (!guest_name) {
    return res.status(400).json({ error: 'guest_name is required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO queue_entries (location_id, guest_name, status)
       VALUES ($1, $2, 'waiting')
       RETURNING *`,
      [location_id, guest_name]
    );

    const entry = result.rows[0];

    const posResult = await db.query(
      `SELECT COUNT(*) as position FROM queue_entries
       WHERE location_id = $1 AND status = 'waiting'
         AND joined_at <= $2`,
      [location_id, entry.joined_at]
    );

    res.status(201).json({
      queue_id: entry.id,
      position: parseInt(posResult.rows[0].position),
      message: `You are #${posResult.rows[0].position} in line`
    });

  } catch (err) {
    console.error('POST /v1/queue/:location_id/join error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /v1/queue/:location_id/leave
router.delete('/:location_id/leave', async (req, res) => {
  const { location_id } = req.params;
  const { queue_id } = req.body;

  if (!queue_id) {
    return res.status(400).json({ error: 'queue_id is required' });
  }

  try {
    await db.query(
      `UPDATE queue_entries SET status = 'left' WHERE id = $1`,
      [queue_id]
    );

    res.json({ message: 'Left the queue' });

  } catch (err) {
    console.error('DELETE /v1/queue/:location_id/leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;