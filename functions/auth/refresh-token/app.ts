import { APIGatewayProxyHandler } from 'aws-lambda';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const { refresh_token } = JSON.parse(event.body || '{}');

        if (!refresh_token) {
            return errorResponse('Refresh token is required', 400);
        }

        // Add more detailed logging
        console.log('Attempting to refresh session with token:', refresh_token?.substring(0, 10) + '...');

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token,
        });

        // Log the full response for debugging
        console.log('Refresh response:', {
            data,
            error,
            hasSession: !!data?.session,
            hasUser: !!data?.user,
        });

        if (error) {
            console.error('Supabase refresh error:', error);
            return errorResponse(`Refresh failed: ${error.message}`, 401);
        }

        // Check if we got null data back
        if (!data || (!data.session && !data.user)) {
            console.error('Received null data from refreshSession');
            return errorResponse('Invalid refresh token or token already used', 401);
        }

        if (!data.session) {
            console.error('No session in refresh response');
            return errorResponse('Failed to refresh session', 401);
        }

        console.log('Refresh successful for user:', data.user?.id);

        return successResponse({
            session: data.session,
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        return errorResponse('Internal server error', 500);
    }
};
