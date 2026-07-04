const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /v1/sessions — start playing on a court
router.post('/', async (req, res) => {
  const { court_id, location_id, duration_mins, player_name, partners } = req.body;

  // Validate duration — only 30, 60, or 90 accepted
  if (![30, 60, 90].includes(duration_mins)) {
    return res.status(400).json({ error: 'duration_mins must be 30, 60, or 90' });
  }

  // Validate required fields
  if (!court_id || !location_id || !player_name) {
    return res.status(400).json({ error: 'court_id, location_id and player_name are required' });
  }

  if (!partners || partners.length === 0) {
    return res.status(400).json({ error: 'At least one partner name is required' });
  }

  try {
    // Check court is actually available right now
    const courtResult = await db.query(
      `SELECT * FROM courts WHERE id = $1`,
      [court_id]
    );

    if (!courtResult.rows.length) {
      return res.status(404).json({ error: 'Court not found' });
    }

    const court = courtResult.rows[0];

    if (court.status === 'closed') {
      return res.status(409).json({ error: 'This court is closed for maintenance' });
    }

    // Check no active session already exists for this court
    const activeSession = await db.query(
      `SELECT id FROM sessions WHERE court_id = $1 AND status = 'active'`,
      [court_id]
    );

    if (activeSession.rows.length > 0) {
      return res.status(409).json({ error: 'This court already has an active session' });
    }

    // Calculate end time
    const endsAt = new Date(Date.now() + duration_mins * 60 * 1000);

    // Create the session
    const sessionResult = await db.query(
      `INSERT INTO sessions
        (court_id, location_id, player_name, partners_json, duration_mins, ends_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [court_id, location_id, player_name, JSON.stringify(partners), duration_mins, endsAt]
    );

    const session = sessionResult.rows[0];

    // Update court status to in_use
    await db.query(
      `UPDATE courts SET status = 'in_use' WHERE id = $1`,
      [court_id]
    );

    res.status(201).json({
      session_id: session.id,
      court_id: session.court_id,
      player_name: session.player_name,
      partners: session.partners_json,
      duration_mins: session.duration_mins,
      started_at: session.started_at,
      ends_at: session.ends_at,
      status: session.status
    });

  } catch (err) {
    console.error('POST /v1/sessions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /v1/sessions/:id — end a session early
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Find the session
    const sessionResult = await db.query(
      `SELECT * FROM sessions WHERE id = $1 AND status = 'active'`,
      [id]
    );

    if (!sessionResult.rows.length) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const session = sessionResult.rows[0];

    // Mark session as ended early
    await db.query(
      `UPDATE sessions 
       SET status = 'ended_early', ended_at = now() 
       WHERE id = $1`,
      [id]
    );

    // Set court back to available
    await db.query(
      `UPDATE courts SET status = 'available' WHERE id = $1`,
      [session.court_id]
    );

    // Check if anyone is in the queue for this location
    const queueResult = await db.query(
      `SELECT qe.*, u.push_token 
       FROM queue_entries qe
       LEFT JOIN users u ON u.id = qe.user_id
       WHERE qe.location_id = $1 
         AND qe.status = 'waiting'
       ORDER BY qe.joined_at ASC 
       LIMIT 1`,
      [session.location_id]
    );

    if (queueResult.rows.length > 0) {
      const nextInLine = queueResult.rows[0];

      // Mark them as notified
      await db.query(
        `UPDATE queue_entries SET notified_at = now() WHERE id = $1`,
        [nextInLine.id]
      );

      // TODO Week 4: send push notification to nextInLine.push_token
      console.log(`Queue notification: ${nextInLine.id} is next in line at location ${session.location_id}`);
    }

    res.json({ message: 'Session ended', court_id: session.court_id });

  } catch (err) {
    console.error('DELETE /v1/sessions/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /v1/sessions/:id/extend — add 30 more minutes
router.post('/:id/extend', async (req, res) => {
  const { id } = req.params;

  try {
    const sessionResult = await db.query(
      `SELECT s.*, l.id as loc_id FROM sessions s
       JOIN locations l ON l.id = s.location_id
       WHERE s.id = $1 AND s.status = 'active'`,
      [id]
    );

    if (!sessionResult.rows.length) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const session = sessionResult.rows[0];

    // Max 4 extensions
    if (session.extended_count >= 4) {
      return res.status(409).json({ error: 'Maximum extensions reached' });
    }

    // Check queue is empty
    const queueResult = await db.query(
      `SELECT id FROM queue_entries 
       WHERE location_id = $1 AND status = 'waiting'`,
      [session.location_id]
    );

    if (queueResult.rows.length > 0) {
      return res.status(409).json({
        error: 'queue_not_empty',
        message: 'Someone is waiting — you cannot extend while others are in the queue',
        queue_length: queueResult.rows.length
      });
    }

    // Add 30 minutes
    const newEndsAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.query(
      `UPDATE sessions 
       SET ends_at = $1, extended_count = extended_count + 1 
       WHERE id = $2`,
      [newEndsAt, id]
    );

    res.json({
      message: 'Session extended by 30 minutes',
      ends_at: newEndsAt,
      extended_count: session.extended_count + 1
    });

  } catch (err) {
    console.error('POST /v1/sessions/:id/extend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;