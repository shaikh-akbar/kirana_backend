const crypto = require('crypto');

/**
 * Generates a channel-prefixed, time-sortable, collision-resistant order
 * number, e.g. RET-20260805143210-4f9a. Does not depend on the row's
 * auto-increment id, so it can be computed before the INSERT runs.
 */
function generateOrderNumber(channel) {
  const prefix = channel === 'WHOLESALE' ? 'WHS' : 'RET';
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${prefix}-${stamp}-${suffix}`;
}

module.exports = { generateOrderNumber };
