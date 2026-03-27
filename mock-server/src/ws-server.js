const { WebSocketServer } = require('ws');
const { handleCommand } = require('./mqtt-server');

function startWsServer(engine, { port = 8082 } = {}) {
  const wss = new WebSocketServer({ port });
  const clients = new Set();

  wss.on('listening', () => {
    console.log(`[WS] WebSocket server listening on port ${port}`);
  });

  wss.on('connection', (socket, req) => {
    const addr = req.socket.remoteAddress;
    console.log(`[WS] Client connected: ${addr}`);
    clients.add(socket);

    // Send current status on connect
    socket.send(JSON.stringify({
      type: 'status',
      data: engine.getStatus(),
    }));

    socket.on('message', (raw) => {
      try {
        const cmd = JSON.parse(raw.toString());
        handleCommand(engine, cmd);
      } catch (e) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[WS] Client disconnected: ${addr}`);
    });

    socket.on('error', (err) => {
      console.error(`[WS] Socket error: ${err.message}`);
      clients.delete(socket);
    });
  });

  // Broadcast binary frames (Buffer sent as-is over WebSocket)
  engine.on('frame', (binaryPayload) => {
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(binaryPayload);
      }
    }
  });

  // Broadcast status changes
  engine.on('status', (status) => {
    const msg = JSON.stringify({ type: 'status', data: status });
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(msg);
      }
    }
  });

  return wss;
}

module.exports = { startWsServer };
