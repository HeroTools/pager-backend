interface SignInRequestBody {
    email: string;
    password: string;
}

interface UserProfile {
    id: string;
    email: string;
    name?: string;
    avatar_url?: string;
    created_at: string;
    updated_at: string;
    last_workspace_id?: string;
}

interface Workspace {
    id: string;
    name: string;
    slug: string;
    description?: string;
    avatar_url?: string;
    created_at: string;
    updated_at: string;
    // User's role in this workspace
    role: 'owner' | 'admin' | 'member' | 'guest';
    // Workspace settings that might affect routing
    is_active: boolean;
}

interface SignInResponse {
    user: any; // Supabase user object
    session: any; // Supabase session object
    profile: UserProfile;
    workspaces: Workspace[];
    defaultWorkspaceId?: string;
}

export { SignInRequestBody, UserProfile, Workspace, SignInResponse };
