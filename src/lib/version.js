// The running app's version. Semver from package.json, plus an optional build id (a git short SHA set at deploy
// time via BUILD / GIT_SHA / SOURCE_VERSION) so two deploys of the same version are still told apart. A browser
// that loaded an older build sees this change and offers to reload — the "self-updating" client.
const { version } = require('../../package.json');

const build = (process.env.BUILD || process.env.GIT_SHA || process.env.SOURCE_VERSION || '').trim().slice(0, 40) || null;
const startedAt = new Date().toISOString();
// What a client compares against: version plus build, so a redeploy without a version bump still counts as new.
const tag = build ? `${version}+${build}` : version;

module.exports = { version, build, startedAt, tag };
