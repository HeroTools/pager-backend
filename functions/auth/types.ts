export interface SignInResponse {
  user: any; // Supabase user object
  session: any; // Supabase session object
  profile: UserProfile;
  workspaces: Workspace[];
  defaultWorkspaceId?: string;
}

export interface AuthResponse {
  user: AuthUser;
  session: AuthSession;
  profile: UserProfile;
  workspaces: Workspace[];
  default_workspace_id?: string;
  message?: string;
  is_new_user?: boolean;
  requires_email_confirmation?: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  email_confirmed_at?: string | null;
  created_at: string;
  updated_at?: string;
  user_metadata?: Record<string, any>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  last_workspace_id?: string;
  preferences?: UserPreferences;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  timezone?: string;
  language?: string;
  notifications?: NotificationSettings;
}

export interface NotificationSettings {
  email?: boolean;
  push?: boolean;
  mentions?: boolean;
  updates?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  image?: string;
  description?: string;
  is_active: boolean;
  role: WorkspaceRole;
  settings?: WorkspaceSettings;
  created_at: string;
  updated_at: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceSettings {
  is_public?: boolean;
  allow_invites?: boolean;
  default_role?: WorkspaceRole;
}

export interface SignInRequestBody {
  email: string;
  password: string;
}

export interface SignUpRequestBody {
  email: string;
  password: string;
  name: string;
  invite_token?: string;
}

export interface InviteDetails {
  workspace_id: string;
  workspace_name: string;
  inviter_name?: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
  joined_at: string;
  invited_by?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    request_id?: string;
  };
}

export type AuthApiResponse = ApiResponse<AuthResponse>;

export interface DatabaseUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  last_workspace_id?: string;
  preferences?: UserPreferences;
  created_at: string;
  updated_at: string;
}

export interface DatabaseWorkspace {
  id: string;
  name: string;
  image?: string;
  description?: string;
  is_active: boolean;
  settings?: WorkspaceSettings;
  created_at: string;
  updated_at: string;
}

export interface DatabaseWorkspaceMember {
  user_id: string;
  workspace_id: string;
  role: WorkspaceRole;
  joined_at: string;
  invited_by?: string;
}

export interface UpdateUserPreferencesRequest {
  last_workspace_id?: string;
}

export interface UserPreferences {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
  last_workspace_id?: string;
}

export interface UpdateUserPreferencesResponse {
  preferences: UserPreferences;
}
