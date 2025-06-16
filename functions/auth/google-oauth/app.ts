import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { redirectTo } = JSON.parse(event.body || '{}');

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo || `${process.env.FRONTEND_URL}/auth/callback`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            },
        });

        if (error) {
            return errorResponse(error.message, 400);
        }

        return successResponse({
            url: data.url,
            provider: 'google',
        });
    } catch (error) {
        console.error('Error initiating Google auth:', error);
        return errorResponse('Internal server error', 500);
    }
};
