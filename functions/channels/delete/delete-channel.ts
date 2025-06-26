import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getChannelMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

const lambdaClient = new LambdaClient({ region: 'us-east-2' });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const channelId = event.pathParameters?.channelId;
        const workspaceId = event.pathParameters?.workspaceId;

        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400);
        }

        // Get channel and validate it belongs to the specified workspace
        const { data: channel, error: channelError } = await supabase
            .from('channels')
            .select('id, workspace_id')
            .eq('id', channelId)
            .eq('workspace_id', workspaceId)
            .is('deleted_at', null) // Only get non-deleted channels
            .single();

        if (channelError || !channel) {
            return errorResponse('Channel not found or access denied', 404);
        }

        // Check if user is an admin of the channel
        const channelMember = await getChannelMember(channelId, userId, workspaceId);

        if (!channelMember || channelMember.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        const { error: softDeleteError } = await supabase
            .from('channels')
            .update({
                deleted_at: new Date().toISOString(),
            })
            .eq('id', channelId);

        if (softDeleteError) {
            throw softDeleteError;
        }

        try {
            await lambdaClient.send(
                new InvokeCommand({
                    FunctionName: process.env.MESSAGE_CLEANUP_FUNCTION_ARN,
                    InvocationType: InvocationType.Event,
                    Payload: JSON.stringify({
                        channelId,
                    }),
                }),
            );
        } catch (lambdaError) {
            console.error('Failed to trigger message cleanup lambda:', lambdaError);
        }

        return successResponse({
            channelId,
            message: 'Channel deleted successfully',
        });
    } catch (error) {
        console.error('Error deleting channel:', error);
        return errorResponse('Internal server error', 500);
    }
};
