import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createClient } from '@supabase/supabase-js';
import { successResponse, errorResponse } from '../../common/utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const authHeader = event.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authorization header required', 401);
    }

    const token = authHeader.substring(7);

    // Create a new client with the user's session
    const userSupabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { error } = await userSupabase.auth.signOut();

    if (error) {
      return errorResponse(error.message, 400);
    }

    return successResponse({ message: 'Signed out successfully' });
  } catch (error) {
    console.error('Error signing out:', error);
    return errorResponse('Internal server error', 500);
  }
};
