// db/oracle.js
const oracledb = require('oracledb');
require('dotenv').config();

// node-oracledb v6 defaults to Thin mode (no Oracle Client needed)
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

// Force LOB and long VARCHAR2 columns to return as plain JS strings
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];

let pool = null;

async function initPool() {
  try {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECTION_STRING,
      poolMin: parseInt(process.env.DB_POOL_MIN) || 2,
      poolMax: parseInt(process.env.DB_POOL_MAX) || 10,
      poolIncrement: parseInt(process.env.DB_POOL_INCR) || 1
    });
    console.log('✅ Oracle Database connection pool created');
    return pool;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    throw err;
  }
}

async function getConnection() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return await pool.getConnection();
}

async function closePool() {
  if (pool) {
    await pool.close();
    console.log('Database pool closed');
  }
}

module.exports = { initPool, getConnection, closePool };