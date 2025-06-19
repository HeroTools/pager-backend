import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { email, password, name } = JSON.parse(event.body || '{}');

        if (!email || !password) {
            return errorResponse('Email and password are required', 400);
        }
        if (!name) {
            return errorResponse('Name is required', 400);
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { name } },
        });
        if (signUpError || !data.user) {
            return errorResponse(signUpError?.message || 'Failed to create user', 400);
        }

        const userId = data.user.id;

        const { error: profileError } = await supabase.from('users').insert({ id: userId, email, name, image: null });

        if (profileError) {
            console.error('Profile insert error:', profileError);

            const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
            if (deleteError) {
                console.error('Failed to roll back auth user:', deleteError);
            }

            return errorResponse('Failed to create user profile', 500);
        }

        const isEmailConfirmed = Boolean(data.user.email_confirmed_at);
        const payload = {
            user: data.user,
            session: data.session,
            requires_email_confirmation: !isEmailConfirmed,
            message: isEmailConfirmed
                ? 'User created and signed in successfully'
                : 'Please check your email to confirm your account',
        };
        return successResponse(payload, isEmailConfirmed ? 200 : 201);
    } catch (err) {
        console.error('Sign-up handler error:', err);
        return errorResponse('Internal server error', 500);
    }
};
