import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { z } from 'zod';

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
        let parsedBody;
        try {
            const body = JSON.parse(event.body || '{}');
            parsedBody = registerSchema.parse(body);
        } catch (error) {
            if (error instanceof z.ZodError) {
                const firstError = error.errors[0];
                return errorResponse(firstError.message, 400);
            }
            return errorResponse('Invalid JSON in request body', 400);
        }

        const { email, password, name, inviteToken } = parsedBody;

        let inviteData = null;
        let workspaceToJoin = null;

        if (inviteToken) {
            const now = new Date().toISOString();
            const { data: tokenData, error: tokenError } = await supabase
                .from('workspace_invite_tokens')
                .select('*, workspaces!inner(id, name)')
                .eq('token', inviteToken)
                .gte('expires_at', now)
                .single();

            if (tokenError || !tokenData) {
                return errorResponse('Invalid or expired invite token', 400);
            }

            if (tokenData.max_uses && tokenData.usage_count >= tokenData.max_uses) {
                return errorResponse('Invite token has reached its usage limit', 400);
            }

            inviteData = tokenData;
            workspaceToJoin = tokenData.workspaces;
        }

        const { data: existingUser, error: userCheckError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', email)
            .single();

        // Only return error if it's NOT a "no rows found" error
        if (userCheckError && userCheckError.code !== 'PGRST116') {
            console.error('User check error:', userCheckError);
            return errorResponse('Database error during user check', 500);
        }

        let userId: string;
        let authResult: any = null;
        let isNewUser = false;

        if (existingUser) {
            // User exists - they're trying to join another workspace
            if (!inviteToken) {
                return errorResponse('User already exists. Please sign in instead.', 400);
            }

            // Try to sign them in with provided credentials
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInError) {
                return errorResponse('Invalid credentials for existing user', 401);
            }

            userId = existingUser.id;
            authResult = signInData;
        } else {
            // New user registration
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { name } },
            });

            if (signUpError || !signUpData.user) {
                return errorResponse(signUpError?.message || 'Failed to create user', 400);
            }

            userId = signUpData.user.id;
            authResult = signUpData;
            isNewUser = true;

            // Create user profile for new users
            const { error: profileError } = await supabase.from('users').insert({
                id: userId,
                email,
                name,
                image: null,
            });

            if (profileError) {
                console.error('Profile insert error:', profileError);

                // Rollback auth user creation
                const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
                if (deleteError) {
                    console.error('Failed to roll back auth user:', deleteError);
                }

                return errorResponse('Failed to create user profile', 500);
            }
        }

        // Handle workspace invitation if token provided
        if (inviteData && workspaceToJoin) {
            // Check if user is already a member of this workspace
            const { data: existingMember, error: existingMemberError } = await supabase
                .from('workspace_members')
                .select('id, is_deactivated')
                .eq('workspace_id', inviteData.workspace_id)
                .eq('user_id', userId)
                .single();

            // Only return error if it's NOT a "no rows found" error
            if (existingMemberError && existingMemberError.code !== 'PGRST116') {
                console.error('Error checking existing member:', existingMemberError);
                return errorResponse('Failed to check workspace membership', 500);
            }

            if (existingMember) {
                if (existingMember.is_deactivated) {
                    // Reactivate deactivated member
                    const { error: reactivateError } = await supabase
                        .from('workspace_members')
                        .update({
                            is_deactivated: false,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', existingMember.id);

                    if (reactivateError) {
                        console.error('Error reactivating member:', reactivateError);
                        return errorResponse('Failed to reactivate workspace membership', 500);
                    }
                } else {
                    return errorResponse('User is already a member of this workspace', 400);
                }
            } else {
                // Add user to workspace
                const { error: memberError } = await supabase.from('workspace_members').insert({
                    user_id: userId,
                    workspace_id: inviteData.workspace_id,
                    role: 'member',
                });

                if (memberError) {
                    console.error('Error adding workspace member:', memberError);

                    // If this was a new user, rollback everything
                    if (isNewUser) {
                        await supabase.from('users').delete().eq('id', userId);
                        await supabase.auth.admin.deleteUser(userId);
                    }

                    return errorResponse('Failed to join workspace', 500);
                }
            }

            // Run in parallel to optimize (with better error handling)
            const [userUpdateResult, tokenUpdateResult] = await Promise.allSettled([
                supabase.from('users').update({ last_workspace_id: inviteData.workspace_id }).eq('id', userId),
                supabase
                    .from('workspace_invite_tokens')
                    .update({
                        usage_count: inviteData.usage_count + 1,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', inviteData.id),
            ]);

            // Log any failures for monitoring
            if (userUpdateResult.status === 'rejected') {
                console.error('Error updating user last_workspace_id:', userUpdateResult.reason);
            }
            if (tokenUpdateResult.status === 'rejected') {
                console.error('Error updating token usage:', tokenUpdateResult.reason);
            }
        }

        const isEmailConfirmed = Boolean(authResult.user?.email_confirmed_at);

        const payload = {
            user: authResult.user,
            session: authResult.session,
            workspace: workspaceToJoin,
            is_new_user: isNewUser,
            requires_email_confirmation: !isEmailConfirmed,
            message: isNewUser
                ? isEmailConfirmed
                    ? workspaceToJoin
                        ? `User created and joined workspace "${workspaceToJoin.name}" successfully`
                        : 'User created and signed in successfully'
                    : 'Please check your email to confirm your account'
                : `Successfully joined workspace "${workspaceToJoin?.name}"`,
        };

        return successResponse(payload, isEmailConfirmed ? 200 : 201);
    } catch (err) {
        console.error('Register handler error:', err);
        return errorResponse('Internal server error', 500);
    }
};
