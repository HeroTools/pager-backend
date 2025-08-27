import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getLinearMCPInstance } from '../../agents/chat/mcp/linear-server';

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const authCode = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;

    if (!authHeader || !authCode) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          error: 'Missing authorization header or auth code',
        }),
      };
    }

    const userId = await getUserIdFromToken(authHeader);
    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized',
        }),
      };
    }

    const linearServer = getLinearMCPInstance();
    if (!linearServer) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Linear MCP server not initialized',
        }),
      };
    }

    // Handle the auth callback
    const success = await linearServer.handleAuthCallback(userId, authCode);

    if (success) {
      // Redirect to frontend with success
      return {
        statusCode: 302,
        headers: {
          Location: `${process.env.FRONTEND_URL}/integrations/linear?status=success`,
        },
      };
    } else {
      return {
        statusCode: 302,
        headers: {
          Location: `${process.env.FRONTEND_URL}/integrations/linear?status=error`,
        },
      };
    }
  } catch (error) {
    console.error('Linear auth callback error:', error);
    
    return {
      statusCode: 302,
      headers: {
        Location: `${process.env.FRONTEND_URL}/integrations/linear?status=error`,
      },
    };
  }
};