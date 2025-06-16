const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [];

const defaultHeaders: Record<string, string> = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
};

const isAllowedOrigin = (origin: string): boolean => {
  return allowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin.includes("*")) {
      // Convert the allowed origin pattern to a regex
      const regexPattern = allowedOrigin
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(origin);
    } else {
      return allowedOrigin === origin;
    }
  });
};

export const setCorsHeaders = (
  origin: string | undefined,
  additionalMethods = ""
): Record<string, string> => {
  const headers: Record<string, string> = {
    ...defaultHeaders,
  };
  console.log(`Origin: ${origin}`);
  console.log(`allowedOrigins: ${allowedOrigins}`);
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    // For requests without an Origin header or from disallowed origins
    // We don't set the Access-Control-Allow-Origin header, which will prevent the browser from accessing the response
    console.warn(`Rejected request from origin: ${origin}`);
  }

  const methods =
    "OPTIONS" + (additionalMethods ? "," + additionalMethods : "");
  headers["Access-Control-Allow-Methods"] = methods;
  return headers;
};

export const errorResponse = (
  message: string,
  statusCode = 500,
  additionalHeaders: Record<string, string> = {},
  errorDetails = {}
) => {
  const headers = { ...additionalHeaders };
  return {
    statusCode,
    body: JSON.stringify({ error: message, ...errorDetails }),
    headers,
  };
};

export const successResponse = (
  body: unknown,
  statusCode = 200,
  additionalHeaders: Record<string, string> = {}
) => {
  const headers = { ...additionalHeaders };
  return {
    statusCode,
    body: JSON.stringify(body),
    headers,
  };
};
