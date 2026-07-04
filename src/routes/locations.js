const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius_miles = 10, sport, city } = req.query;

    let whereClause = 'WHERE l.active = true';
    const params = [];

    if (city) {
      params.push(city);
      whereClause += ` AND LOWER(l.city) = LOWER($${params.length})`;
    }
    if (sport) {
      params.push(sport);
      whereClause += ` AND l.sport = $${params.length}`;
    }

    const locationsResult = await db.query(`
      SELECT l.*,
        ROUND(AVG(r.score)::numeric, 1) AS rating,
        COUNT(DISTINCT r.id) AS reviews
      FROM locations l
      LEFT JOIN ratings r ON r.location_id = l.id
      ${whereClause}
      GROUP BY l.id
      ORDER BY l.name ASC
    `, params);

    const enriched = await Promise.all(locationsResult.rows.map(async (loc) => {
      const courtsResult = await db.query(`
        SELECT c.*, s.id AS session_id, s.player_name,
               s.partners_json, s.ends_at, s.extended_count, s.duration_mins
        FROM courts c
        LEFT JOIN sessions s ON s.court_id = c.id AND s.status = 'active'
        WHERE c.location_id = $1
        ORDER BY c.label ASC
      `, [loc.id]);

      const queueResult = await db.query(`
        SELECT qe.id, COALESCE(u.display_name, qe.guest_name, 'Guest') AS name
        FROM queue_entries qe
        LEFT JOIN users u ON u.id = qe.user_id
        WHERE qe.location_id = $1 AND qe.status = 'waiting'
        ORDER BY qe.joined_at ASC
      `, [loc.id]);

      let distanceMiles = null;
      if (lat && lng) {
        const R = 3958.8;
        const dLat = (loc.lat - parseFloat(lat)) * Math.PI / 180;
        const dLng = (loc.lng - parseFloat(lng)) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2
          + Math.cos(parseFloat(lat) * Math.PI/180)
          * Math.cos(loc.lat * Math.PI/180)
          * Math.sin(dLng/2)**2;
        distanceMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }

      if (lat && lng && distanceMiles > parseFloat(radius_miles)) return null;

      return {
        ...loc,
        rating: loc.rating ? parseFloat(loc.rating) : 0,
        reviews: parseInt(loc.reviews) || 0,
        amenities: {
          lights: loc.lights,
          parking: loc.parking,
          restrooms: loc.restrooms,
          water: loc.water
        },
        hours: loc.hours_json,
        courts: courtsResult.rows.map(row => ({
          id: row.id,
          name: row.label,
          status: row.status,
          closeReason: row.close_reason,
          session: row.session_id ? {
            id: row.session_id,
            partners: [row.player_name, ...(row.partners_json || [])],
            endsAt: new Date(row.ends_at).getTime(),
            durationMin: row.duration_mins,
            expired: new Date(row.ends_at) < new Date(),
            extendedCount: row.extended_count
          } : null
        })),
        queue: queueResult.rows,
        distanceMiles
      };
    }));

    const filtered = enriched
      .filter(Boolean)
      .sort((a, b) => (a.distanceMiles || 999) - (b.distanceMiles || 999));

    res.json(filtered);

  } catch (err) {
    console.error('GET /v1/locations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const locResult = await db.query(`
      SELECT l.*,
        ROUND(AVG(r.score)::numeric, 1) AS rating,
        COUNT(DISTINCT r.id) AS reviews
      FROM locations l
      LEFT JOIN ratings r ON r.location_id = l.id
      WHERE l.id = $1
      GROUP BY l.id
    `, [id]);

    if (!locResult.rows.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const loc = locResult.rows[0];

    const courtsResult = await db.query(`
      SELECT c.*, s.id AS session_id, s.player_name,
             s.partners_json, s.ends_at, s.extended_count, s.duration_mins
      FROM courts c
      LEFT JOIN sessions s ON s.court_id = c.id AND s.status = 'active'
      WHERE c.location_id = $1
      ORDER BY c.label ASC
    `, [id]);

    const queueResult = await db.query(`
      SELECT qe.id, COALESCE(u.display_name, qe.guest_name, 'Guest') AS name
      FROM queue_entries qe
      LEFT JOIN users u ON u.id = qe.user_id
      WHERE qe.location_id = $1 AND qe.status = 'waiting'
      ORDER BY qe.joined_at ASC
    `, [id]);

    res.json({
      ...loc,
      rating: loc.rating ? parseFloat(loc.rating) : 0,
      reviews: parseInt(loc.reviews) || 0,
      amenities: {
        lights: loc.lights,
        parking: loc.parking,
        restrooms: loc.restrooms,
        water: loc.water
      },
      hours: loc.hours_json,
      courts: courtsResult.rows.map(row => ({
        id: row.id,
        name: row.label,
        status: row.status,
        closeReason: row.close_reason,
        session: row.session_id ? {
          id: row.session_id,
          partners: [row.player_name, ...(row.partners_json || [])],
          endsAt: new Date(row.ends_at).getTime(),
          durationMin: row.duration_mins,
          expired: new Date(row.ends_at) < new Date(),
          extendedCount: row.extended_count
        } : null
      })),
      queue: queueResult.rows
    });

  } catch (err) {
    console.error('GET /v1/locations/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;