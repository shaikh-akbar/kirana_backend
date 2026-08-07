const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'kirana_erp',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
});

/**
 * Runs `work` inside a single transactional connection and guarantees
 * commit/rollback/release. Use for any multi-statement write (orders,
 * ledger updates, stock deduction) so partial failures cannot corrupt state.
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} work
 */
async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { pool, withTransaction };
