// Express helpers
const monitor = require('./monitor');

// Wrap async handlers so rejections reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function errorHandler(err, req, res, _next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  monitor.captureError(err, { id: req.id, m: req.method, p: req.originalUrl.split('?')[0] });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { wrap, HttpError, errorHandler };
