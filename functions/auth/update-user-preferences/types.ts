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