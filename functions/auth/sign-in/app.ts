import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { SignInRequestBody, UserProfile, Workspace, SignInResponse } from './types';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const body: SignInRequestBody = JSON.parse(event.body || '{}');
        const { email, password } = body;

        if (!email || !password) {
            return errorResponse('Email and password are required', 400);
        }

        // Authenticate user
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

        // Fetch user profile and workspaces in parallel
        const [profileResult, workspacesResult] = await Promise.allSettled([
            // Get user profile
            supabase.from('users').select('*').eq('id', userId).single(),

            // Get user's workspaces with their roles
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
                .eq('workspaces.is_active', true) // Only active workspaces
                .order('created_at', { ascending: true, referencedTable: 'workspaces' }),
        ]);

        // Handle profile fetch result
        let userProfile: UserProfile | null = null;
        if (profileResult.status === 'fulfilled' && !profileResult.value.error) {
            userProfile = profileResult.value.data;
        } else {
            console.warn(
                'Failed to fetch user profile:',
                profileResult.status === 'rejected' ? profileResult.reason : profileResult.value.error,
            );
        }

        // Handle workspaces fetch result
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

        // Determine default workspace
        let defaultWorkspaceId: string | undefined;

        if (workspaces.length > 0) {
            // Priority: last_workspace_id > first owned workspace > first workspace
            if (userProfile?.last_workspace_id) {
                const lastWorkspace = workspaces.find((w) => w.id === userProfile.last_workspace_id);
                if (lastWorkspace) {
                    defaultWorkspaceId = lastWorkspace.id;
                }
            }

            if (!defaultWorkspaceId) {
                // Find first owned workspace
                const ownedWorkspace = workspaces.find((w) => w.role === 'owner');
                defaultWorkspaceId = ownedWorkspace?.id || workspaces[0].id;
            }
        }

        const response: SignInResponse = {
            user: authData.user,
            session: authData.session,
            profile: userProfile || {
                id: userId,
                email: authData.user.email!,
                created_at: authData.user.created_at!,
                updated_at: new Date().toISOString(),
            },
            workspaces,
            defaultWorkspaceId,
        };

        return successResponse(response);
    } catch (error) {
        console.error('Error signing in:', error);
        return errorResponse('Internal server error', 500);
    }
};
