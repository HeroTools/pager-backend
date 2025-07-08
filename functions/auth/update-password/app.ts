import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { successResponse, errorResponse } from '../../common/utils/response';
import { createClient } from '@supabase/supabase-js';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { password } = JSON.parse(event.body || '{}');

        if (!password) {
            return errorResponse('Password is required', 400);
        }

        const token = event.headers.Authorization?.substring(7);

        // Create a new client with the user's session
        const userSupabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
            global: {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
        });

        const { error } = await userSupabase.auth.updateUser({
            password,
        });

        if (error) {
            return errorResponse(error.message, 400);
        }

        return successResponse({
            message: 'Password updated successfully',
        });
    } catch (error) {
        console.error('Error updating password:', error);
        return errorResponse('Internal server error', 500);
    }
};
