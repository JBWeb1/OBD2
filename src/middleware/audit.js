// Records every successful state-changing API call (who, what, which record). Request bodies are NOT stored.
const db = require('../db');

module.exports = function audit(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    const path = req.originalUrl.split('?')[0].replace(/^\/api/, '');
    const parts = path.split('/').filter(Boolean);
    const id = parts.find((p, i) => i > 0 && /^\d+$/.test(p));
    db.query(
      `INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.tenantId, req.user.id, req.user.name, `${req.method} ${path}`.slice(0, 200), parts[0] || null, id ? Number(id) : null, res.statusCode]
    ).catch(() => { /* never break a request over logging */ });
  });
  next();
};
