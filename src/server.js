const { config } = require('./config');
const { createApp } = require('./app');
const monitor = require('./lib/monitor');

const app = createApp();
const server = app.listen(config.port, () => monitor.log('info', `DiagnosticOS listening on :${config.port}`));

if (process.env.RUN_SCHEDULER !== 'false') require('./jobs/scheduler').start();

process.on('unhandledRejection', (e) => monitor.captureError(e instanceof Error ? e : new Error(String(e)), { where: 'unhandledRejection' }));
const shutdown = () => { monitor.log('info', 'shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
