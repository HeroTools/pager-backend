import crypto from 'crypto';

export class WebhookSecurity {
  static generateSecrets() {
    return {
      secret_token: crypto.randomBytes(32).toString('hex'),
      signing_secret: crypto.randomBytes(32).toString('hex'),
    };
  }

  static verifySignature(
    payload: string,
    signature: string,
    secret: string,
    timestamp: string,
  ): boolean {
    const expectedSignature = this.generateSignature(payload, secret, timestamp);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }

  static generateSignature(payload: string, secret: string, timestamp: string): string {
    const baseString = `v0:${timestamp}:${payload}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(baseString);
    return `v0=${hmac.digest('hex')}`;
  }

  static isTimestampValid(timestamp: string, toleranceSeconds = 300): boolean {
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    return Math.abs(now - requestTime) <= toleranceSeconds;
  }
}
