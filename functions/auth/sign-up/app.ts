import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { parseRpcError } from './utils/errors';

const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    name: z.string().min(1, 'Name is required').trim(),
    inviteToken: z.string().optional(),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (event.httpMethod !== 'POST') {
            return errorResponse('Method not allowed', 405);
        }

        const body = JSON.parse(event.body || '{}');
        const parsedBody = registerSchema.parse(body);
        const { email, password, name, inviteToken } = parsedBody;

        let authResult: { user: User; session: Session };
        let isNewUser = false;
        let workspaceJoined: { id: string; name: string } | null = null;

        const { data: existingUser, error: userCheckError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (userCheckError && userCheckError.code !== 'PGRST116') {
            return errorResponse('Database error during user check', 500);
        }

        if (existingUser) {
            // User exists: Sign them in
            if (!inviteToken) {
                return errorResponse('User already exists. Please sign in.', 409);
            }
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (signInError || !signInData.user || !signInData.session) {
                return errorResponse('Invalid credentials for existing user.', 401);
            }
            authResult = signInData;
        } else {
            // New user: Sign them up
            isNewUser = true;
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { name } },
            });
            if (signUpError || !signUpData.user || !signUpData.session) {
                return errorResponse(signUpError?.message || 'Failed to create user', 400);
            }
            authResult = signUpData;
        }

        const { user, session } = authResult;

        if (inviteToken) {
            const { data, error: rpcError } = await supabase.rpc('register_and_join_workspace', {
                p_user_id: user.id,
                p_user_email: email,
                p_user_name: name,
                p_invite_token: inviteToken,
            });

            if (rpcError) {
                // The transaction failed. If we just created the user, we should roll back the auth user.
                if (isNewUser) {
                    await supabase.auth.admin.deleteUser(user.id);
                }
                const { statusCode, message } = parseRpcError(rpcError);
                return errorResponse(message, statusCode);
            }
            workspaceJoined = data;
        } else if (isNewUser) {
            // If it's a new user without an invite, we still need to create their public profile.
            const { error: profileError } = await supabase.from('users').insert({ id: user.id, email, name });
            if (profileError) {
                await supabase.auth.admin.deleteUser(user.id); // Rollback
                return errorResponse('Failed to create user profile.', 500);
            }
        }

        const isEmailConfirmed = Boolean(user.email_confirmed_at);
        const message = isNewUser
            ? 'Registration successful. Please check your email to confirm your account.'
            : `Successfully signed in and joined workspace "${workspaceJoined?.name}".`;

        const payload = {
            message,
            session: {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_in: session.expires_in,
            },
            user: {
                id: user.id,
                email: user.email,
                name: user.user_metadata.name,
                email_confirmed_at: user.email_confirmed_at,
                created_at: user.created_at,
            },
            workspace: workspaceJoined,
            is_new_user: isNewUser,
            requires_email_confirmation: !isEmailConfirmed,
        };

        return successResponse(payload, isNewUser ? 201 : 200);
    } catch (err: any) {
        console.error('Register handler error:', err);
        if (err instanceof z.ZodError) {
            return errorResponse(err.errors[0].message, 400);
        }
        return errorResponse('Internal server error', 500);
    }
};
