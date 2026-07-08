const db = require('../db');
const { broadcast } = require('../ws');

async function runExpiryCheck(){
  try {
    // Find all sessions that have run past their end time
    const expired = await db.query(`
      SELECT s.*, c.location_id
      FROM sessions s
      JOIN courts c ON c.id = s.court_id
      WHERE s.status = 'active'
        AND s.ends_at < now() - interval '2 minutes'
    `);

    for (const session of expired.rows){

      // Mark session as expired
      await db.query(
        `UPDATE sessions SET status = 'expired' WHERE id = $1`,
        [session.id]
      );

      // Set court back to available
      await db.query(
        `UPDATE courts SET status = 'available' WHERE id = $1`,
        [session.court_id]
      );

      // This runs on a timer, not in response to a request from any one
      // browser, so it has to push the update out itself rather than
      // relying on an HTTP response to carry the news.
      broadcast('court_update', {
        location_id: session.location_id,
        court_id: session.court_id,
        status: 'available',
        session: null
      });

      console.log(`⏰ Session ${session.id} expired — court ${session.court_id} now available`);

      // Check if anyone is waiting in the queue for this location
      const queueResult = await db.query(`
        SELECT qe.*, u.push_token
        FROM queue_entries qe
        LEFT JOIN users u ON u.id = qe.user_id
        WHERE qe.location_id = $1
          AND qe.status = 'waiting'
        ORDER BY qe.joined_at ASC
        LIMIT 1
      `, [session.location_id]);

      if (queueResult.rows.length > 0){
        const next = queueResult.rows[0];

        // Mark them as notified
        await db.query(
          `UPDATE queue_entries SET notified_at = now() WHERE id = $1`,
          [next.id]
        );

        // TODO Week 4: send push notification to next.push_token
        console.log(`🔔 Queue notification: ${next.guest_name || next.user_id} is next in line`);
      }
    }

    // Expire queue entries where notified person didn't claim within 10 minutes
    const staleQueue = await db.query(`
      UPDATE queue_entries
      SET status = 'expired'
      WHERE status = 'waiting'
        AND notified_at IS NOT NULL
        AND notified_at < now() - interval '10 minutes'
        AND claimed_at IS NULL
      RETURNING id, location_id
    `);

    if (staleQueue.rows.length > 0){
      console.log(`🗑 Expired ${staleQueue.rows.length} stale queue entries`);

      // One or more locations just lost a queue entry — refresh each
      // affected location's waiting list for everyone watching it live.
      const affectedLocations = [...new Set(staleQueue.rows.map(r => r.location_id))];
      for (const locationId of affectedLocations){
        const remaining = await db.query(
          `SELECT id, guest_name AS name FROM queue_entries
           WHERE location_id = $1 AND status = 'waiting'
           ORDER BY joined_at ASC`,
          [locationId]
        );
        broadcast('queue_update', { location_id: locationId, queue: remaining.rows });
      }
    }

  } catch(err) {
    console.error('Session expiry job error:', err);
  }
}

// Run every 2 minutes
function startExpiryJob(){
  console.log('⏱ Session expiry job started');
  setInterval(runExpiryCheck, 2 * 60 * 1000);
  // Also run once immediately on startup
  runExpiryCheck();
}

module.exports = { startExpiryJob };