import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Ensure raw SQL parameterized queries are strictly managed via this single pool.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false, // Mandatory strict transit
});


pool.on('error', (err) => {
  console.error('CRITICAL: Unexpected error on idle Postgres client', err);
  process.exit(-1);
});
