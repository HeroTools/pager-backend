import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Callback,
  Context,
  Handler,
} from 'aws-lambda';

interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  allowCredentials: boolean;
  maxAge: number;
  allowVercelPreviews?: boolean;
  vercelProjects?: string[];
  vercelBaseDomain?: string;
}

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build Vercel preview origin patterns from project slugs.
 * Uses your wildcard-aware matcher (e.g. https://project-git-*.vercel.app).
 */
function buildVercelPreviewOrigins(projects: string[], base = 'vercel.app'): string[] {
  if (!projects.length) return [];
  const withHttps = (host: string) => `https://${host}`;

  const patterns: string[] = [];
  for (const p of projects) {
    patterns.push(withHttps(`${p}.${base}`));
    patterns.push(withHttps(`${p}-git-*.${base}`));
    patterns.push(withHttps(`${p}-*.${base}`));
  }
  return patterns;
}

const defaultConfig: CorsConfig = (() => {
  const allowedOrigins = envList('ALLOWED_ORIGINS');
  const allowVercelPreviews =
    (process.env.ALLOW_VERCEL_PREVIEWS ?? 'true').toLowerCase() !== 'false';
  const vercelProjects = envList('VERCEL_PROJECTS');
  const vercelBaseDomain = process.env.VERCEL_BASE_DOMAIN?.trim() || 'vercel.app';

  const vercelOrigins = allowVercelPreviews
    ? buildVercelPreviewOrigins(vercelProjects, vercelBaseDomain)
    : [];

  return {
    allowedOrigins: [...allowedOrigins, ...vercelOrigins],
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Amz-Date',
      'X-Api-Key',
      'X-Amz-Security-Token',
      'X-Requested-With',
    ],
    allowCredentials: true,
    maxAge: 86400,

    allowVercelPreviews,
    vercelProjects,
    vercelBaseDomain,
  };
})();

function normalizeOrigin(event: APIGatewayProxyEvent): string | undefined {
  return event.headers.origin || event.headers.Origin || (event.headers as any)['origin'];
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    return false;
  }

  return allowedOrigins.some((pattern) => {
    if (pattern === '*') {
      return true;
    }

    // Wildcard support: user can provide things like https://*.example.com or https://project-git-*.vercel.app
    if (pattern.includes('*')) {
      const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      const regex = new RegExp(`^${escapedPattern}$`, 'i');
      return regex.test(origin);
    }

    return pattern.toLowerCase() === origin.toLowerCase();
  });
}

function getRequestedMethod(event: APIGatewayProxyEvent): string | null {
  const requestedMethod =
    event.headers['access-control-request-method'] ||
    event.headers['Access-Control-Request-Method'];
  return requestedMethod || null;
}

function getRequestedHeaders(event: APIGatewayProxyEvent): string[] {
  const requestedHeaders =
    event.headers['access-control-request-headers'] ||
    event.headers['Access-Control-Request-Headers'];
  return requestedHeaders ? requestedHeaders.split(',').map((h) => h.trim()) : [];
}

export function buildCorsHeaders(
  event: APIGatewayProxyEvent,
  config: Partial<CorsConfig> = {},
): Record<string, string> {
  const corsConfig = { ...defaultConfig, ...config };

  const mergedAllowedOrigins = [
    ...new Set([
      ...corsConfig.allowedOrigins,
      ...(corsConfig.allowVercelPreviews
        ? buildVercelPreviewOrigins(
            corsConfig.vercelProjects ?? defaultConfig.vercelProjects ?? [],
            corsConfig.vercelBaseDomain || defaultConfig.vercelBaseDomain || 'vercel.app',
          )
        : []),
    ]),
  ];

  const origin = normalizeOrigin(event);
  const headers: Record<string, string> = {};

  if (origin && isAllowedOrigin(origin, mergedAllowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = origin;
    if (corsConfig.allowCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  } else if (mergedAllowedOrigins.includes('*') && !corsConfig.allowCredentials) {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  // Cache per-Origin behaviour
  headers['Vary'] = 'Origin';

  if (event.httpMethod === 'OPTIONS') {
    headers['Access-Control-Allow-Methods'] = (corsConfig.allowedMethods || []).join(',');
    headers['Access-Control-Allow-Headers'] = (corsConfig.allowedHeaders || []).join(',');
    headers['Access-Control-Max-Age'] = String(corsConfig.maxAge ?? 86400);

    const requestedMethod = getRequestedMethod(event);
    if (requestedMethod && !(corsConfig.allowedMethods || []).includes(requestedMethod)) {
      throw new Error(`Method ${requestedMethod} not allowed`);
    }

    const requestedHeaders = getRequestedHeaders(event);
    const disallowedHeaders = requestedHeaders.filter(
      (header) =>
        !(corsConfig.allowedHeaders || []).some(
          (allowed) => allowed.toLowerCase() === header.toLowerCase(),
        ),
    );

    if (disallowedHeaders.length > 0) {
      throw new Error(`Headers not allowed: ${disallowedHeaders.join(', ')}`);
    }
  }

  return headers;
}

type SimpleHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
type FullHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>,
) => Promise<APIGatewayProxyResult>;

export function withCors(
  handler: SimpleHandler | FullHandler,
  config: Partial<CorsConfig> = {},
): Handler<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return async (
    event: APIGatewayProxyEvent,
    context: Context,
    callback: Callback<APIGatewayProxyResult>,
  ): Promise<APIGatewayProxyResult> => {
    try {
      const corsHeaders = buildCorsHeaders(event, config);

      if (event.httpMethod === 'OPTIONS') {
        return {
          statusCode: 204,
          headers: corsHeaders,
          body: '',
        };
      }

      const origin = normalizeOrigin(event);

      if (origin && !corsHeaders['Access-Control-Allow-Origin']) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: `Origin not allowed: ${origin}` }),
        };
      }

      const response = await handler(event, context, callback);

      if (!response) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Handler returned no response' }),
        };
      }

      return {
        statusCode: response.statusCode || 200,
        headers: {
          ...corsHeaders,
          ...(response.headers || {}),
        },
        body: response.body || '',
        ...(response.multiValueHeaders && { multiValueHeaders: response.multiValueHeaders }),
        ...(response.isBase64Encoded !== undefined && {
          isBase64Encoded: response.isBase64Encoded,
        }),
      };
    } catch (error) {
      console.error('CORS error:', error);
      const origin = normalizeOrigin(event);
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        },
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'CORS error',
        }),
      };
    }
  };
}

export const createCorsHandler = (config: Partial<CorsConfig> = {}) => {
  return function <T extends SimpleHandler | FullHandler>(handler: T) {
    return withCors(handler, config);
  };
};
