const { pool } = require('../../config/db');
const queries = require('./inventory.queries');

async function getLowStockProducts() {
  return queries.findLowStockProducts(pool);
}

module.exports = { getLowStockProducts };
