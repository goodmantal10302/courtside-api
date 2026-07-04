const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /v1/admin/locations — create a new location
router.post('/locations', async (req, res) => {
  const { name, sport, type, address, city, lat, lng, hours_json,
          surface, setting, lights, parking, restrooms, water } = req.body;

  if (!name || !sport || !type || !address || !city || !lat || !lng) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await db.query(
      `INSERT INTO locations
        (name, sport, type, address, city, lat, lng, hours_json,
         surface, setting, lights, parking, restrooms, water)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [name, sport, type, address, city, lat, lng,
       JSON.stringify(hours_json || {}),
       surface || 'hard', setting || 'outdoor',
       lights || false, parking || false,
       restrooms || false, water || false]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error('POST /v1/admin/locations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /v1/admin/locations/:id — update a location
router.put('/locations/:id', async (req, res) => {
  const { id } = req.params;
  const { name, sport, type, address, city, hours_json,
          surface, setting, lights, parking, restrooms, water } = req.body;

  try {
    const result = await db.query(
      `UPDATE locations SET
        name=$1, sport=$2, type=$3, address=$4, city=$5,
        hours_json=$6, surface=$7, setting=$8,
        lights=$9, parking=$10, restrooms=$11, water=$12
       WHERE id=$13 RETURNING *`,
      [name, sport, type, address, city,
       JSON.stringify(hours_json || {}),
       surface, setting, lights, parking, restrooms, water, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('PUT /v1/admin/locations/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /v1/admin/courts — add a court to a location
router.post('/courts', async (req, res) => {
  const { location_id, label } = req.body;

  if (!location_id || !label) {
    return res.status(400).json({ error: 'location_id and label are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO courts (location_id, label, status)
       VALUES ($1, $2, 'available')
       RETURNING *`,
      [location_id, label]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error('POST /v1/admin/courts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /v1/admin/courts/:id/close
router.post('/courts/:id/close', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    await db.query(
      `UPDATE courts SET status = 'closed', close_reason = $1 WHERE id = $2`,
      [reason || 'Maintenance', id]
    );

    res.json({ message: 'Court closed', reason });

  } catch (err) {
    console.error('POST /v1/admin/courts/:id/close error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /v1/admin/courts/:id/reopen
router.post('/courts/:id/reopen', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE courts SET status = 'available', close_reason = NULL WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Court reopened' });

  } catch (err) {
    console.error('POST /v1/admin/courts/:id/reopen error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /v1/admin/courts/:id
router.delete('/courts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(`DELETE FROM courts WHERE id = $1`, [id]);
    res.json({ message: 'Court deleted' });

  } catch (err) {
    console.error('DELETE /v1/admin/courts/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;