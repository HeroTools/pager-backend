import { Pool } from 'pg';

const dbPool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: parseInt(process.env.PG_PORT || '5432'),
    max: parseInt(process.env.PG_MAX_CLIENTS || '2', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '10000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT_MS || '2000', 10),
});

export default dbPool;
