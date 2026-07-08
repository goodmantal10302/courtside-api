const express = require('express');
const router = express.Router();
const db = require('../db');
const { broadcast } = require('../ws');

// Fetch the current waiting list for a location and push it out to
// everyone connected, so avatar stacks / "N waiting" counts update live.
async function broadcastQueue(location_id) {
  const result = await db.query(
    `SELECT id, guest_name AS name FROM queue_entries
     WHERE location_id = $1 AND status = 'waiting'
     ORDER BY joined_at ASC`,
    [location_id]
  );

  broadcast('queue_update', {
    location_id,
    queue: result.rows
  });
}

// GET /v1/queue/mine?device_id=... — is this device already waiting somewhere?
router.get('/mine', async (req, res) => {
  const { device_id } = req.query;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }

  try {
    const result = await db.query(
      `SELECT qe.*, l.name AS location_name
       FROM queue_entries qe
       JOIN locations l ON l.id = qe.location_id
       WHERE qe.device_id = $1 AND qe.status = 'waiting'
       ORDER BY qe.joined_at DESC
       LIMIT 1`,
      [device_id]
    );

    if (!result.rows.length) {
      return res.json({ entry: null });
    }

    res.json({ entry: result.rows[0] });

  } catch (err) {
    console.error('GET /v1/queue/mine error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /v1/queue/:location_id/join
router.post('/:location_id/join', async (req, res) => {
  const { location_id } = req.params;
  const { guest_name, device_id } = req.body;

  if (!guest_name) {
    return res.status(400).json({ error: 'guest_name is required' });
  }

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }

  try {
    // Block if this device already has an active session anywhere —
    // you can't wait in line while you're already playing
    const activeSession = await db.query(
      `SELECT s.id, l.name AS location_name, c.label AS court_label
       FROM sessions s
       JOIN locations l ON l.id = s.location_id
       JOIN courts c ON c.id = s.court_id
       WHERE s.device_id = $1 AND s.status = 'active'`,
      [device_id]
    );

    if (activeSession.rows.length > 0) {
      const existing = activeSession.rows[0];
      return res.status(409).json({
        error: 'already_playing',
        message: `You're already playing on ${existing.court_label} at ${existing.location_name} — you can't join a queue at the same time.`
      });
    }

    // Block if this device is already waiting in a queue elsewhere
    const activeQueue = await db.query(
      `SELECT qe.id, l.name AS location_name
       FROM queue_entries qe
       JOIN locations l ON l.id = qe.location_id
       WHERE qe.device_id = $1 AND qe.status = 'waiting'`,
      [device_id]
    );

    if (activeQueue.rows.length > 0) {
      const existing = activeQueue.rows[0];
      return res.status(409).json({
        error: 'already_queued',
        message: `You're already waiting in the queue at ${existing.location_name}. Leave that queue first.`
      });
    }

    const result = await db.query(
      `INSERT INTO queue_entries (location_id, device_id, guest_name, status)
       VALUES ($1, $2, $3, 'waiting')
       RETURNING *`,
      [location_id, device_id, guest_name]
    );

    const entry = result.rows[0];

    const posResult = await db.query(
      `SELECT COUNT(*) as position FROM queue_entries
       WHERE location_id = $1 AND status = 'waiting'
         AND joined_at <= $2`,
      [location_id, entry.joined_at]
    );

    await broadcastQueue(location_id);

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
// DELETE /v1/queue/:location_id/leave
router.delete('/:location_id/leave', async (req, res) => {
  const { location_id } = req.params;
  const { queue_id, device_id } = req.body;

  if (!queue_id) {
    return res.status(400).json({ error: 'queue_id is required' });
  }

  try {
    await db.query(
      `UPDATE queue_entries SET status = 'left' WHERE id = $1 AND ($2::text IS NULL OR device_id = $2)`,
      [queue_id, device_id || null]
    );

    await broadcastQueue(location_id);

    res.json({ message: 'Left the queue' });

  } catch (err) {
    console.error('DELETE /v1/queue/:location_id/leave error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;