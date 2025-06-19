import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { email, password, name } = JSON.parse(event.body || '{}');

        if (!email || !password) {
            return errorResponse('Email and password are required', 400);
        }

        if (!name) {
            return errorResponse('Name is required', 400);
        }

        // Sign up user with Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name,
                },
            },
        });

        if (error) {
            return errorResponse(error.message, 400);
        }

        if (!data.user) {
            return errorResponse('Failed to create user', 400);
        }

        // Create user profile in users table
        const { error: profileError } = await supabase.from('users').insert({
            id: data.user.id,
            email: data.user.email,
            name,
            image: null,
        });

        if (profileError) {
            console.error('Error creating user profile:', profileError);
        }

        // Determine what happens next based on email confirmation
        const isEmailConfirmed = !!data.user.email_confirmed_at;

        return successResponse({
            user: data.user,
            session: data.session,
            requires_email_confirmation: !isEmailConfirmed,
            message: isEmailConfirmed
                ? 'User created and signed in successfully'
                : 'Please check your email to confirm your account',
        });
    } catch (error) {
        console.error('Error signing up:', error);
        return errorResponse('Internal server error', 500);
    }
};
