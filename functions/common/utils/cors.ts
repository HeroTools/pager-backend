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
}

const defaultConfig: CorsConfig = {
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [],
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
};

function normalizeOrigin(event: APIGatewayProxyEvent): string | undefined {
  return event.headers.origin || event.headers.Origin || event.headers['origin'];
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    return false;
  }

  return allowedOrigins.some((pattern) => {
    if (pattern === '*') {
      return true;
    }

    if (pattern.includes('*')) {
      const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      const regex = new RegExp(`^${escapedPattern}$`, 'i');
      const matches = regex.test(origin);
      return matches;
    }

    const exactMatch = pattern.toLowerCase() === origin.toLowerCase();
    return exactMatch;
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
  const origin = normalizeOrigin(event);
  const headers: Record<string, string> = {};

  if (origin && isAllowedOrigin(origin, corsConfig.allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = origin;
    if (corsConfig.allowCredentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  } else if (corsConfig.allowedOrigins.includes('*') && !corsConfig.allowCredentials) {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  headers['Vary'] = 'Origin';

  if (event.httpMethod === 'OPTIONS') {
    headers['Access-Control-Allow-Methods'] = corsConfig.allowedMethods.join(',');
    headers['Access-Control-Allow-Headers'] = corsConfig.allowedHeaders.join(',');
    headers['Access-Control-Max-Age'] = corsConfig.maxAge.toString();

    const requestedMethod = getRequestedMethod(event);
    if (requestedMethod && !corsConfig.allowedMethods.includes(requestedMethod)) {
      throw new Error(`Method ${requestedMethod} not allowed`);
    }

    const requestedHeaders = getRequestedHeaders(event);
    const disallowedHeaders = requestedHeaders.filter(
      (header) =>
        !corsConfig.allowedHeaders.some(
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
          body: JSON.stringify({ error: 'Origin not allowed' }),
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
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': normalizeOrigin(event) || '*',
          'Access-Control-Allow-Credentials': 'true',
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
