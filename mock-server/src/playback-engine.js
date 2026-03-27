const { EventEmitter } = require('events');
const { generatePixels, packBinaryFrame } = require('./pixel-generator');

class PlaybackEngine extends EventEmitter {
  constructor(frames) {
    super();
    this.frames = frames;
    this.index = 0;
    this.speed = 5.0;
    this.state = 'stopped'; // stopped | playing | paused
    this.loop = false;
    this._timer = null;
  }

  get totalFrames() {
    return this.frames.length;
  }

  get progress() {
    return this.totalFrames > 0 ? this.index / this.totalFrames : 0;
  }

  get currentTimestamp() {
    return this.frames[this.index]?.timestamp ?? null;
  }

  /**
   * Build a binary frame buffer ready for wire transmission.
   * Layout: 28-byte header + cols*rows pixel bytes.
   */
  _buildFramePayload(idx) {
    const f = this.frames[idx];
    const pixels = generatePixels(f, idx);
    return packBinaryFrame(f, idx, pixels);
  }

  /**
   * Build a JSON-only metadata payload (used by REST API).
   */
  _buildMetadataPayload(idx) {
    const f = this.frames[idx];
    return {
      seq: idx,
      timestamp: f.timestamp,
      resolution: f.resolution,
      origin: { x: f.origin_x, y: f.origin_y },
      grid: { cols: f.map_cols, rows: f.map_rows },
      playback: {
        speed: this.speed,
        progress: idx / this.totalFrames,
        state: this.state,
        index: idx,
        total: this.totalFrames,
      },
    };
  }

  _scheduleNext() {
    if (this.state !== 'playing') return;
    if (this.index >= this.totalFrames) {
      if (this.loop) {
        this.index = 0;
      } else {
        this.stop();
        return;
      }
    }

    const payload = this._buildFramePayload(this.index);
    this.emit('frame', payload);

    const nextIdx = this.index + 1;
    if (nextIdx < this.totalFrames) {
      const deltaUs = this.frames[nextIdx].timestamp - this.frames[this.index].timestamp;
      const delayMs = Math.max(1, (deltaUs / 1000) / this.speed);
      this.index = nextIdx;
      this._timer = setTimeout(() => this._scheduleNext(), delayMs);
    } else {
      this.index = nextIdx;
      this._timer = setTimeout(() => this._scheduleNext(), 80);
    }
  }

  start() {
    if (this.state === 'playing') return;
    if (this.state === 'stopped') {
      this.index = 0;
    }
    this.state = 'playing';
    this._emitStatus();
    this._scheduleNext();
  }

  pause() {
    if (this.state !== 'playing') return;
    clearTimeout(this._timer);
    this._timer = null;
    this.state = 'paused';
    this._emitStatus();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this._emitStatus();
    this._scheduleNext();
  }

  stop() {
    clearTimeout(this._timer);
    this._timer = null;
    this.index = 0;
    this.state = 'stopped';
    this._emitStatus();
  }

  setSpeed(speed) {
    this.speed = Math.max(0.1, Math.min(speed, 32));
    this._emitStatus();
  }

  seek(timestamp) {
    let lo = 0, hi = this.totalFrames - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].timestamp < timestamp) lo = mid + 1;
      else hi = mid;
    }
    this.index = lo;

    if (this.state === 'playing') {
      clearTimeout(this._timer);
      this._scheduleNext();
    } else {
      const payload = this._buildFramePayload(this.index);
      this.emit('frame', payload);
    }
    this._emitStatus();
  }

  setLoop(loop) {
    this.loop = !!loop;
  }

  getStatus() {
    return {
      state: this.state,
      speed: this.speed,
      loop: this.loop,
      index: this.index,
      total: this.totalFrames,
      progress: this.progress,
      currentTimestamp: this.currentTimestamp,
    };
  }

  _emitStatus() {
    this.emit('status', this.getStatus());
  }
}

module.exports = { PlaybackEngine };
