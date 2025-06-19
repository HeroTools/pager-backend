import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import crypto from 'crypto';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) return errorResponse('Unauthorized', 401);

        const { workspaceId, refresh = false } = JSON.parse(event.body || '{}');
        if (!workspaceId) {
            return errorResponse('workspaceId is required', 400);
        }

        const member = await getMember(workspaceId, userId);
        if (!member) {
            return errorResponse('Member not part of workspace', 403);
        }

        const now = new Date().toISOString();

        if (!refresh) {
            const { data: existing, error: fetchErr } = await supabase
                .from('workspace_invite_tokens')
                .select('*')
                .eq('workspace_id', workspaceId)
                .gte('expires_at', now)
                .single();

            // Ignore “no rows” error code
            if (fetchErr && fetchErr.code !== 'PGRST116') {
                console.error('Error fetching existing token:', fetchErr);
                return errorResponse('Database error', 500);
            }
            if (existing) {
                return successResponse({
                    token: existing.token,
                    expires_at: existing.expires_at,
                    url: `${process.env.FRONTEND_URL}/register?invitation=${existing.token}`,
                });
            }
        }

        const newToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data, error: upsertErr } = await supabase
            .from('workspace_invite_tokens')
            .upsert(
                {
                    workspace_id: workspaceId,
                    token: newToken,
                    expires_at: expiresAt,
                    updated_at: now,
                },
                { onConflict: 'workspace_id' },
            )
            .select('*')
            .single();

        if (upsertErr || !data) {
            console.error('Error upserting token:', upsertErr);
            return errorResponse('Failed to create or refresh token', 500);
        }

        return successResponse({
            token: data.token,
            expires_at: data.expires_at,
            url: `${process.env.FRONTEND_URL}/register?invitation=${data.token}`,
        });
    } catch (err) {
        console.error('Unhandled error generating invite token:', err);
        return errorResponse('Internal server error', 500);
    }
};
