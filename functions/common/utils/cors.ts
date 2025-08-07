import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, Handler } from 'aws-lambda';

interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  allowCredentials: boolean;
  maxAge: number;
}

const defaultConfig: CorsConfig = {
  allowedOrigins: [
    'https://pager-dev.vercel.app',
    'http://localhost:3000',
    'https://app.pager.team',
  ],
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

  console.log('Origin from request:', origin);
  console.log('Allowed origins:', corsConfig.allowedOrigins);
  console.log('Is origin allowed:', origin && isAllowedOrigin(origin, corsConfig.allowedOrigins));

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

type SimpleHandler = (
  event: APIGatewayProxyEvent,
  context: Context,
) => Promise<APIGatewayProxyResult>;

export function withCors(
  handler: SimpleHandler,
  config: Partial<CorsConfig> = {},
): Handler<APIGatewayProxyEvent, APIGatewayProxyResult> {
  return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    try {
      const corsHeaders = buildCorsHeaders(event, config);

      if (event.httpMethod === 'OPTIONS') {
        return {
          statusCode: 204,
          headers: corsHeaders,
          body: '',
        };
      }

      // Remove callback parameter
      const response = await handler(event, context);

      console.log('CORS wrapper received response:', response ? 'valid' : 'undefined');

      if (!response) {
        console.error('Handler returned undefined/null response');
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
      };
    } catch (error) {
      console.error('CORS wrapper error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  };
}
