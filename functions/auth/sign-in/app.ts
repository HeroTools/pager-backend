import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { email, password } = JSON.parse(event.body || '{}');

        if (!email || !password) {
            return errorResponse('Email and password are required', 400);
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return errorResponse(error.message, 401);
        }

        if (!data.user || !data.session) {
            return errorResponse('Invalid credentials', 401);
        }

        // Get user profile
        const { data: userProfile } = await supabase.from('users').select('*').eq('id', data.user.id).single();

        return successResponse({
            user: data.user,
            session: data.session,
            profile: userProfile,
        });
    } catch (error) {
        console.error('Error signing in:', error);
        return errorResponse('Internal server error', 500);
    }
};
