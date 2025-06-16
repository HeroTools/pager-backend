import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { refresh_token } = JSON.parse(event.body || '{}');

        if (!refresh_token) {
            return errorResponse('Refresh token is required', 400);
        }

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token,
        });

        if (error) {
            return errorResponse(error.message, 401);
        }

        if (!data.session) {
            return errorResponse('Failed to refresh session', 401);
        }

        return successResponse({
            session: data.session,
            user: data.user,
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        return errorResponse('Internal server error', 500);
    }
};
