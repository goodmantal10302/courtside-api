const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /v1/locations/cities — every city that currently has at least one
// active location, anywhere in the system. Deliberately NOT filtered by
// distance from anything — this is what powers city search and the
// header's current-city label, both of which need to know about a city
// like "Irvine" even when the browser's current radius fetch is centered
// somewhere else entirely (e.g. Ontario) and wouldn't otherwise include it.
router.get('/cities', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT city AS name, AVG(lat) AS lat, AVG(lng) AS lng, COUNT(*) AS count
      FROM locations
      WHERE active = true
      GROUP BY city
      ORDER BY city ASC
    `);
    res.json(result.rows.map(r => ({
      name: r.name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lng),
      count: parseInt(r.count, 10)
    })));
  } catch (err) {
    console.error('GET /v1/locations/cities error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /v1/locations/:id/usage — real historical busyness, computed from
// actual session start/end times, not placeholder data. Percentages
// represent, on average over the lookback window, what fraction of this
// location's courts were occupied during each hour. Kept as its own
// endpoint (rather than bundled into the main list) since it's a heavier
// aggregate query and only ever needed for whichever single location
// someone actually has open.
router.get('/:id/usage', async (req, res) => {
  try {
    const { id } = req.params;
    const LOOKBACK_DAYS = 56; // ~8 weeks — long enough to smooth out one-off busy/quiet days
    const weeksInWindow = LOOKBACK_DAYS / 7;

    const courtsResult = await db.query(
      `SELECT COUNT(*) AS count FROM courts WHERE location_id = $1`,
      [id]
    );
    const totalCourts = parseInt(courtsResult.rows[0].count, 10) || 1;

    const samplesResult = await db.query(
      `SELECT COUNT(*) AS count FROM sessions
       WHERE location_id = $1 AND started_at >= now() - interval '${LOOKBACK_DAYS} days'`,
      [id]
    );
    const samples = parseInt(samplesResult.rows[0].count, 10);

    const bucketsResult = await db.query(`
      SELECT
        EXTRACT(DOW FROM hour_slot)::int AS dow,
        EXTRACT(HOUR FROM hour_slot)::int AS hr,
        COUNT(*) AS occupied_hours
      FROM sessions s,
        LATERAL generate_series(
          date_trunc('hour', s.started_at),
          date_trunc('hour', COALESCE(s.ended_at, s.ends_at)) - interval '1 second',
          interval '1 hour'
        ) AS hour_slot
      WHERE s.location_id = $1
        AND s.started_at >= now() - interval '${LOOKBACK_DAYS} days'
      GROUP BY dow, hr
    `, [id]);

    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const DISPLAY_HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am–9pm
    const hourLabel = (h) => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h-12}p`;

    const data = {};
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => { data[d] = DISPLAY_HOURS.map(() => 0); });

    bucketsResult.rows.forEach(row => {
      const dayName = DAY_NAMES[row.dow];
      const hIdx = DISPLAY_HOURS.indexOf(row.hr);
      if (hIdx === -1) return;
      const pct = Math.min(100, Math.round((row.occupied_hours / (totalCourts * weeksInWindow)) * 100));
      data[dayName][hIdx] = pct;
    });

    res.json({
      samples,
      hours: DISPLAY_HOURS.map(hourLabel),
      data
    });

  } catch (err) {
    console.error('GET /v1/locations/:id/usage error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /v1/locations/:id/weather — an estimated "when will this court be
// dry" reading, based on real recent precipitation from Open-Meteo
// (free, no API key needed: https://open-meteo.com). This is explicitly
// a rough estimate, not a guarantee — actual drying depends on things
// weather data alone can't know (drainage quality, sun exposure, shade),
// so it's deliberately framed to the person as an estimate, not a fact.
router.get('/:id/weather', async (req, res) => {
  try {
    const { id } = req.params;
    const locResult = await db.query(`SELECT lat, lng, surface FROM locations WHERE id = $1`, [id]);
    if (!locResult.rows.length) return res.status(404).json({ error: 'Location not found' });
    const { lat, lng, surface } = locResult.rows[0];
//
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&hourly=precipitation,precipitation_probability,temperature_2m,wind_speed_10m` +
      `&current_weather=true&past_days=1&forecast_days=2&timezone=auto`
    );
    if (!weatherRes.ok) throw new Error('Weather service error');
    const weather = await weatherRes.json();

    const times = weather.hourly.time; // local-time strings like "2026-07-11T14:00", no offset
    const precip = weather.hourly.precipitation;
    const precipProb = weather.hourly.precipitation_probability;
    const temps = weather.hourly.temperature_2m;
    const winds = weather.hourly.wind_speed_10m;

    // Match "now" to its position in the hourly arrays by comparing the
    // date/hour text directly, rather than parsing these into JS Date
    // objects — Open-Meteo's "auto" timezone returns naive local
    // timestamps with no UTC offset, so a server running in a different
    // timezone would silently compute the wrong hour if we did real date
    // math on them instead.
    const nowTimeStr = weather.current_weather.time.slice(0, 13); // "YYYY-MM-DDTHH"
    let nowIdx = times.findIndex(t => t.startsWith(nowTimeStr));
    if (nowIdx === -1) nowIdx = Math.floor(times.length / 2);

    // Look ahead for rain that hasn't happened yet — a separate concern
    // from "is it currently wet," this is "should you expect to get
    // rained on if you start playing now."
    const LOOKAHEAD_HOURS = 8;
    let upcomingRain = null;
    for (let i = nowIdx + 1; i <= Math.min(times.length - 1, nowIdx + LOOKAHEAD_HOURS); i++) {
      const prob = precipProb[i] || 0;
      const amt = precip[i] || 0;
      if (prob >= 50 || amt > 0.1) {
        const hourPart = parseInt(times[i].slice(11, 13), 10);
        const minutePart = times[i].slice(14, 16);
        const period = hourPart >= 12 ? 'PM' : 'AM';
        const hour12 = ((hourPart + 11) % 12) + 1;
        upcomingRain = {
          message: `Rain expected around ${hour12}:${minutePart} ${period}${prob ? ` (${prob}% chance)` : ''}`
        };
        break;
      }
    }

    const isRainingNow = (precip[nowIdx] || 0) > 0.1;

    let hoursSinceRain = null;
    let totalRecentRain = 0;
    for (let i = nowIdx; i >= Math.max(0, nowIdx - 24); i--) {
      totalRecentRain += precip[i] || 0;
      if (hoursSinceRain === null && precip[i] > 0.1) hoursSinceRain = nowIdx - i;
    }

    if (hoursSinceRain === null && !isRainingNow) {
      return res.json({ status: 'dry', upcomingRain });
    }

    if (isRainingNow) {
      return res.json({ status: 'raining', message: 'Raining now — courts likely wet', upcomingRain });
    }

    const currentTemp = temps[nowIdx];
    const currentWind = winds[nowIdx];
    const isSoftSurface = (surface || '').toLowerCase().includes('clay') || (surface || '').toLowerCase().includes('grass');

    let baseDryHours = isSoftSurface ? 5 : 1.5;
    baseDryHours += Math.min(3, totalRecentRain / 5);
    if (currentTemp < 10) baseDryHours += 1;
    if (currentWind < 5) baseDryHours += 0.5;
    if (currentTemp > 25 && currentWind > 15) baseDryHours -= 0.5;
    baseDryHours = Math.max(0.5, baseDryHours);

    const remainingHours = baseDryHours - hoursSinceRain;

    if (remainingHours <= 0) {
      return res.json({ status: 'likely_dry', message: 'Rained recently but should be dry by now', upcomingRain });
    }

    const dryIdx = Math.min(times.length - 1, nowIdx + Math.ceil(remainingHours));
    const dryTimeStr = times[dryIdx];
    const hourPart = parseInt(dryTimeStr.slice(11, 13), 10);
    const minutePart = dryTimeStr.slice(14, 16);
    const period = hourPart >= 12 ? 'PM' : 'AM';
    const hour12 = ((hourPart + 11) % 12) + 1;
    const dryLabel = `${hour12}:${minutePart} ${period}`;

    res.json({
      status: 'wet',
      message: `Rained recently — est. dry by ~${dryLabel}`,
      upcomingRain
    });

  } catch (err) {
    console.error('GET /v1/locations/:id/weather error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius_miles = 10, north, south, east, west, sport, city } = req.query;
    // A bounding box (the actual rectangle currently visible on the map)
    // takes priority over the old circular radius when both are present —
    // "search this area" sends a box; older/simpler calls can still just
    // send lat/lng/radius_miles and get the previous circular behavior.
    const useBbox = north !== undefined && south !== undefined && east !== undefined && west !== undefined;

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

      let withinArea = true;
      if (useBbox) {
        withinArea = loc.lat <= parseFloat(north) && loc.lat >= parseFloat(south)
          && loc.lng <= parseFloat(east) && loc.lng >= parseFloat(west);
      } else if (lat && lng) {
        withinArea = distanceMiles <= parseFloat(radius_miles);
      }
      if (!withinArea) return null;

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