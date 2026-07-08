const { WebSocketServer } = require('ws');

let wss = null;

// Attach a WebSocket server to the same HTTP server Express is using.
// Railway only exposes one port, so the WebSocket has to share it with
// the regular HTTP API rather than running on its own port.
function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (socket) => {
    console.log('🔌 Client connected via WebSocket');
    socket.on('close', () => console.log('🔌 Client disconnected'));
    socket.on('error', (err) => console.error('WebSocket client error:', err));
  });

  console.log('🔌 WebSocket server attached');
  return wss;
}

// Send a message to every connected client.
// type: 'court_update' | 'queue_update'
// payload: whatever data is relevant to that update (see routes/sessions.js
// and routes/queue.js for the exact shapes)
function broadcast(type, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

module.exports = { initWebSocket, broadcast };