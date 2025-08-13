import { Pool } from 'pg';

export class WebhookRateLimiter {
  constructor(private db: Pool) {}

  async checkRateLimit(
    webhookId: string,
    limits: { per_minute: number; per_hour: number },
  ): Promise<{
    allowed: boolean;
    remaining: { minute: number; hour: number };
    resetTime: { minute: Date; hour: Date };
  }> {
    const now = new Date();
    const minuteStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    // Check current usage
    const usageQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN period_type = 'minute' AND period_start = $2 THEN requests_count ELSE 0 END), 0) as minute_usage,
        COALESCE(SUM(CASE WHEN period_type = 'hour' AND period_start = $3 THEN requests_count ELSE 0 END), 0) as hour_usage
      FROM webhook_usage
      WHERE webhook_id = $1
        AND ((period_type = 'minute' AND period_start = $2) OR (period_type = 'hour' AND period_start = $3))
    `;

    const result = await this.db.query(usageQuery, [webhookId, minuteStart, hourStart]);
    const { minute_usage, hour_usage } = result.rows[0];

    const allowed = minute_usage < limits.per_minute && hour_usage < limits.per_hour;

    if (allowed) {
      // Increment usage
      await this.incrementUsage(webhookId, minuteStart, hourStart);
    }

    return {
      allowed,
      remaining: {
        minute: Math.max(0, limits.per_minute - minute_usage - (allowed ? 1 : 0)),
        hour: Math.max(0, limits.per_hour - hour_usage - (allowed ? 1 : 0)),
      },
      resetTime: {
        minute: new Date(minuteStart.getTime() + 60000),
        hour: new Date(hourStart.getTime() + 3600000),
      },
    };
  }

  private async incrementUsage(webhookId: string, minuteStart: Date, hourStart: Date) {
    const query = `
      INSERT INTO webhook_usage (webhook_id, workspace_id, requests_count, period_start, period_end, period_type)
      VALUES
        ($1, (SELECT workspace_id FROM webhooks WHERE id = $1), 1, $2, $2 + INTERVAL '1 minute', 'minute'),
        ($1, (SELECT workspace_id FROM webhooks WHERE id = $1), 1, $3, $3 + INTERVAL '1 hour', 'hour')
      ON CONFLICT (webhook_id, period_start, period_type)
      DO UPDATE SET requests_count = webhook_usage.requests_count + 1
    `;

    await this.db.query(query, [webhookId, minuteStart, hourStart]);
  }
}
