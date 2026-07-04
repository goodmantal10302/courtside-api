require('dotenv').config();
const db = require('./index');

async function seed() {
  console.log('Seeding Thornhill courts...');

  const orgResult = await db.query(`
    INSERT INTO orgs (name, type)
    VALUES ('York Region Parks', 'parks')
    RETURNING id
  `);
  const orgId = orgResult.rows[0].id;
  console.log('✅ Created org');

  const cundlesResult = await db.query(`
    INSERT INTO locations
      (name, sport, type, address, city, lat, lng, hours_json,
       surface, setting, lights, parking, restrooms, owner_org_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING id
  `, [
    'Cundles Park Courts', 'tennis', 'public',
    'Cundles Park, Carrville', 'Thornhill',
    43.8702, -79.4280,
    '{"Mon":{"open":"07:00","close":"21:00"},"Tue":{"open":"07:00","close":"21:00"},"Wed":{"open":"07:00","close":"21:00"},"Thu":{"open":"07:00","close":"21:00"},"Fri":{"open":"07:00","close":"21:00"},"Sat":{"open":"07:00","close":"21:00"},"Sun":{"open":"07:00","close":"21:00"}}',
    'hard', 'outdoor', true, true, true, orgId
  ]);
  const cundlesId = cundlesResult.rows[0].id;
  for (let i = 1; i <= 4; i++) {
    await db.query(`INSERT INTO courts (location_id, label) VALUES ($1, $2)`, [cundlesId, `Court ${i}`]);
  }
  console.log('✅ Created Cundles Park with 4 courts');

  const greenwayResult = await db.query(`
    INSERT INTO locations
      (name, sport, type, address, city, lat, lng, hours_json, surface, setting, owner_org_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `, [
    'Carrville Greenway Court', 'tennis', 'public',
    'Carrville Greenway Path', 'Thornhill',
    43.8651, -79.4198,
    '{"Mon":{"open":"06:00","close":"22:00"},"Tue":{"open":"06:00","close":"22:00"},"Wed":{"open":"06:00","close":"22:00"},"Thu":{"open":"06:00","close":"22:00"},"Fri":{"open":"06:00","close":"22:00"},"Sat":{"open":"06:00","close":"22:00"},"Sun":{"open":"06:00","close":"22:00"}}',
    'hard', 'outdoor', orgId
  ]);
  const greenwayId = greenwayResult.rows[0].id;
  await db.query(`INSERT INTO courts (location_id, label) VALUES ($1, 'Court 1')`, [greenwayId]);
  console.log('✅ Created Carrville Greenway with 1 court');

  const crestwoodResult = await db.query(`
    INSERT INTO locations
      (name, sport, type, address, city, lat, lng, hours_json,
       surface, setting, parking, water, owner_org_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id
  `, [
    'Crestwood Secondary School Courts', 'tennis', 'school',
    'Crestwood Secondary School', 'Thornhill',
    43.8675, -79.4350,
    '{"Mon":{"open":"15:00","close":"20:00"},"Tue":{"open":"15:00","close":"20:00"},"Wed":{"open":"15:00","close":"20:00"},"Thu":{"open":"15:00","close":"20:00"},"Fri":{"open":"15:00","close":"20:00"},"Sat":{"open":"08:00","close":"20:00"},"Sun":{"open":"08:00","close":"20:00"}}',
    'hard', 'outdoor', true, true, orgId
  ]);
  const crestwoodId = crestwoodResult.rows[0].id;
  for (let i = 1; i <= 2; i++) {
    await db.query(`INSERT INTO courts (location_id, label) VALUES ($1, $2)`, [crestwoodId, `Court ${i}`]);
  }
  console.log('✅ Created Crestwood School with 2 courts');

  console.log('✅ Seed complete');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});