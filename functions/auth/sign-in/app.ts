import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse, setCorsHeaders } from '../../common/utils/response';
import { SignInRequestBody, UserProfile, Workspace, AuthResponse } from '../types';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'POST');

    // 1) Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: '',
        };
    }
    try {
        const body: SignInRequestBody = JSON.parse(event.body || '{}');
        const { email, password } = body;

        if (!email || !password) {
            return errorResponse('Email and password are required', 400);
        }

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (authError) {
            console.error('Authentication error:', authError);
            return errorResponse(authError.message, 401);
        }

        if (!authData.user || !authData.session) {
            return errorResponse('Invalid credentials', 401);
        }

        const userId = authData.user.id;

        const [profileResult, workspacesResult] = await Promise.allSettled([
            supabase.from('users').select('*').eq('id', userId).single(),
            supabase
                .from('workspace_members')
                .select(
                    `
                    role,
                    workspaces (
                        id,
                        name,
                        image,
                        created_at,
                        updated_at,
                        is_active
                    )
                `,
                )
                .eq('user_id', userId)
                .eq('workspaces.is_active', true)
                .order('created_at', { ascending: true, referencedTable: 'workspaces' }),
        ]);

        let userProfile: UserProfile | null = null;
        if (profileResult.status === 'fulfilled' && !profileResult.value.error) {
            userProfile = profileResult.value.data;
        } else {
            console.warn(
                'Failed to fetch user profile:',
                profileResult.status === 'rejected' ? profileResult.reason : profileResult.value.error,
            );
        }

        let workspaces: Workspace[] = [];
        if (workspacesResult.status === 'fulfilled' && !workspacesResult.value.error) {
            workspaces = workspacesResult.value.data.map((item: any) => ({
                ...item.workspaces,
                role: item.role,
            }));
        } else {
            console.warn(
                'Failed to fetch workspaces:',
                workspacesResult.status === 'rejected' ? workspacesResult.reason : workspacesResult.value.error,
            );
        }

        let default_workspace_id: string | undefined;

        if (workspaces.length > 0) {
            if (userProfile?.last_workspace_id) {
                const lastWorkspace = workspaces.find((w) => w.id === userProfile.last_workspace_id);
                if (lastWorkspace) {
                    default_workspace_id = lastWorkspace.id;
                }
            }

            if (!default_workspace_id) {
                const ownedWorkspace = workspaces.find((w) => w.role === 'owner');
                default_workspace_id = ownedWorkspace?.id || workspaces[0].id;

                const { error: updateError } = await supabase
                    .from('users')
                    .update({ last_workspace_id: default_workspace_id })
                    .eq('id', userId);
                if (updateError) {
                    console.error('Error updating user profile:', updateError);
                }
            }
        }

        const response: AuthResponse = {
            user: {
                id: authData.user.id,
                email: authData.user.email!,
                name: authData.user.user_metadata?.name,
                email_confirmed_at: authData.user.email_confirmed_at,
                created_at: authData.user.created_at!,
                updated_at: authData.user.updated_at,
                user_metadata: authData.user.user_metadata,
            },
            session: {
                access_token: authData.session.access_token,
                refresh_token: authData.session.refresh_token,
                expires_in: authData.session.expires_in,
                expires_at: authData.session.expires_at,
                token_type: authData.session.token_type,
            },
            profile: userProfile || {
                id: userId,
                email: authData.user.email!,
                name: authData.user.user_metadata?.name,
                created_at: authData.user.created_at!,
                updated_at: new Date().toISOString(),
            },
            workspaces,
            default_workspace_id,
            is_new_user: false,
        };

        return successResponse(response);
    } catch (error) {
        console.error('Error signing in:', error);
        return errorResponse('Internal server error', 500);
    }
};
