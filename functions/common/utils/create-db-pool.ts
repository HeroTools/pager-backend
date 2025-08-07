import { Pool, PoolClient } from 'pg';

class DatabasePool {
  private pool: Pool;
  private connectionAttempts = 0;
  private lastConnectionError: Error | null = null;

  constructor() {
    this.pool = new Pool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: parseInt(process.env.PG_PORT || '5432'),
      max: 15, // Reduced from default 10 to prevent Supabase overload
      min: 0, // No minimum connections for Lambda
      idleTimeoutMillis: 20000, // Close idle connections after 20s
      connectionTimeoutMillis: 5000, // Fast fail on connection issues
      statement_timeout: 15000, // Kill queries after 15s
      query_timeout: 15000,
    });

    // Enhanced error handling
    this.pool.on('error', (err) => {
      console.error('🔥 Database pool error:', {
        error: err.message,
        timestamp: new Date().toISOString(),
      });
      this.lastConnectionError = err;
    });

    this.pool.on('connect', (client) => {
      this.connectionAttempts++;
      console.log('📊 DB connection established', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount,
      });
    });
  }

  async connect(): Promise<PoolClient> {
    try {
      // Add connection timeout with better error context
      const client = await Promise.race([
        this.pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(
              new Error(
                `Database connection timeout after 5s. Pool state: total=${this.pool.totalCount}, idle=${this.pool.idleCount}, waiting=${this.pool.waitingCount}`,
              ),
            );
          }, 5000),
        ),
      ]);

      // Test the connection immediately
      await client.query('SELECT 1');
      return client;
    } catch (error) {
      console.error('❌ Database connection failed:', {
        error: error.message,
        poolTotal: this.pool.totalCount,
        poolIdle: this.pool.idleCount,
        poolWaiting: this.pool.waitingCount,
        lastError: this.lastConnectionError?.message,
        attempts: this.connectionAttempts,
      });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    let client: PoolClient | null = null;
    try {
      client = await this.connect();
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('DB health check failed:', error.message);
      return false;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  getStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      connectionAttempts: this.connectionAttempts,
      lastError: this.lastConnectionError?.message,
    };
  }

  async end() {
    await this.pool.end();
  }
}

const dbPool = new DatabasePool();
export default dbPool;
