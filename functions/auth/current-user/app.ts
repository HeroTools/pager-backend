import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        // Get user auth data
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(event.headers.Authorization?.substring(7));

        if (authError || !user) {
            return errorResponse('Invalid token', 401);
        }

        // Get user profile
        const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (profileError) {
            console.error('Error getting user profile:', profileError);
        }

        return successResponse({
            user,
            profile: userProfile,
        });
    } catch (error) {
        console.error('Error getting current user:', error);
        return errorResponse('Internal server error', 500);
    }
};
