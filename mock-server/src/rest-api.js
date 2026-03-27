const express = require('express');
const cors = require('cors');

function createRestApi(frames, engine, { port = 8080 } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // --- Dataset metadata ---
  app.get('/api/metadata', (_req, res) => {
    const first = frames[0];
    const last = frames[frames.length - 1];
    res.json({
      totalFrames: frames.length,
      timeRange: {
        start: first?.timestamp,
        end: last?.timestamp,
        durationUs: last ? last.timestamp - first.timestamp : 0,
        durationSec: last ? (last.timestamp - first.timestamp) / 1e6 : 0,
      },
      resolution: first?.resolution,
      grid: { cols: first?.map_cols, rows: first?.map_rows },
    });
  });

  // --- Paginated frame list ---
  app.get('/api/frames', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(200, Math.max(1, parseInt(req.query.size) || 50));
    const start = (page - 1) * size;
    const slice = frames.slice(start, start + size);

    res.json({
      page,
      size,
      total: frames.length,
      totalPages: Math.ceil(frames.length / size),
      data: slice,
    });
  });

  // --- Time range query ---
  app.get('/api/frames/range', (req, res) => {
    const startTs = parseFloat(req.query.start);
    const endTs = parseFloat(req.query.end);

    if (isNaN(startTs) || isNaN(endTs)) {
      return res.status(400).json({ error: 'start and end query params required (timestamps)' });
    }

    const result = frames.filter(
      (f) => f.timestamp >= startTs && f.timestamp <= endTs
    );

    res.json({
      start: startTs,
      end: endTs,
      count: result.length,
      data: result,
    });
  });

  // --- Single frame by timestamp ---
  app.get('/api/frames/:timestamp', (req, res) => {
    const ts = parseFloat(req.params.timestamp);
    const frame = frames.find((f) => f.timestamp === ts);

    if (!frame) {
      return res.status(404).json({ error: 'Frame not found' });
    }
    res.json(frame);
  });

  // --- Playback controls ---
  app.post('/api/playback/start', (_req, res) => {
    engine.start();
    res.json(engine.getStatus());
  });

  app.post('/api/playback/pause', (_req, res) => {
    engine.pause();
    res.json(engine.getStatus());
  });

  app.post('/api/playback/resume', (_req, res) => {
    engine.resume();
    res.json(engine.getStatus());
  });

  app.post('/api/playback/stop', (_req, res) => {
    engine.stop();
    res.json(engine.getStatus());
  });

  app.post('/api/playback/speed', (req, res) => {
    const speed = parseFloat(req.body?.speed);
    if (isNaN(speed)) {
      return res.status(400).json({ error: 'speed (number) is required in body' });
    }
    engine.setSpeed(speed);
    res.json(engine.getStatus());
  });

  app.post('/api/playback/seek', (req, res) => {
    const timestamp = parseFloat(req.body?.timestamp);
    if (isNaN(timestamp)) {
      return res.status(400).json({ error: 'timestamp (number) is required in body' });
    }
    engine.seek(timestamp);
    res.json(engine.getStatus());
  });

  app.get('/api/playback/status', (_req, res) => {
    res.json(engine.getStatus());
  });

  const server = app.listen(port, () => {
    console.log(`[REST] HTTP API listening on port ${port}`);
  });

  return server;
}

module.exports = { createRestApi };
