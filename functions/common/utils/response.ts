export const errorResponse = (
  message: string,
  statusCode = 500,
  additionalHeaders: Record<string, string> = {},
  errorDetails: Record<string, unknown> = {},
) => {
  return {
    statusCode,
    body: JSON.stringify({ error: message, ...errorDetails }),
    headers: additionalHeaders,
  };
};

export const successResponse = (
  body: unknown,
  statusCode = 200,
  additionalHeaders: Record<string, string> = {},
) => {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: additionalHeaders,
  };
};
