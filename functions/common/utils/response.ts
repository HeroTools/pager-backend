import { APIGatewayProxyResult } from 'aws-lambda';

export const errorResponse = (
  message: string,
  statusCode = 500,
  additionalHeaders: Record<string, string> = {},
  errorDetails: Record<string, unknown> = {},
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    },
    body: JSON.stringify({
      error: message,
      ...errorDetails,
    }),
  };
};

export const successResponse = (
  body: unknown,
  statusCode = 200,
  additionalHeaders: Record<string, string> = {},
): APIGatewayProxyResult => {
  let responseBody: string;

  try {
    responseBody = JSON.stringify(body);
  } catch (error) {
    console.error('Failed to stringify response body:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Failed to serialize response' }),
    };
  }

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    },
    body: responseBody,
  };
};
