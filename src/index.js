require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const db = require('./db');
const { startExpiryJob } = require('./jobs/sessionExpiry');
const { initWebSocket } = require('./ws');

const locationsRouter = require('./routes/locations');
const sessionsRouter = require('./routes/sessions');
const queueRouter = require('./routes/queue');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;


app.use(cors());
app.use(express.json());

app.use('/v1/locations', locationsRouter);
app.use('/v1/sessions', sessionsRouter);
app.use('/v1/queue', queueRouter);
app.use('/v1/admin', adminRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Wrap the Express app in a plain HTTP server so the same port can also
// handle WebSocket upgrade requests — Railway only exposes one port per
// service, so the WebSocket has to share it with the regular API.
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 CourtSide API running on http://localhost:${PORT}`);
  startExpiryJob();
});