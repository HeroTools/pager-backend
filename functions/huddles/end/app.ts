import { ChimeSDKMeetingsClient, DeleteMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

interface EndHuddleResponse {
  huddle_id: string;
  ended_at: string;
  duration_seconds: number;
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      // Authentication check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const workspaceId = event.pathParameters?.workspaceId;
      const huddleId = event.pathParameters?.huddleId;

      if (!workspaceId || !huddleId) {
        return errorResponse('Workspace ID and Huddle ID are required', 400);
      }

      const member = await getMember(workspaceId, userId);
      if (!member) {
        return errorResponse('Not a member of this workspace', 403);
      }

      client = await dbPool.connect();
      try {
        await client.query('BEGIN');

        // Get huddle details and verify permissions
        const getHuddleQuery = `
          SELECT
            h.id,
            h.status,
            h.started_at,
            h.metadata,
            h.initiated_by_workspace_member_id,
            hp.role
          FROM huddles h
          LEFT JOIN huddle_participants hp ON hp.huddle_id = h.id AND hp.workspace_member_id = $3
          WHERE h.id = $1 AND h.workspace_id = $2
        `;

        const huddleResult = await client.query(getHuddleQuery, [huddleId, workspaceId, member.id]);

        if (huddleResult.rows.length === 0) {
          return errorResponse('Huddle not found', 404);
        }

        const huddle = huddleResult.rows[0];

        if (huddle.status !== 'active') {
          return errorResponse('Huddle is not active', 400);
        }

        // Check if user has permission to end the huddle (host or initiator)
        if (huddle.initiated_by_workspace_member_id !== member.id && huddle.role !== 'host') {
          return errorResponse('Insufficient permissions to end huddle', 403);
        }

        const endedAt = new Date();
        const durationSeconds = Math.floor(
          (endedAt.getTime() - new Date(huddle.started_at).getTime()) / 1000,
        );

        // Update huddle status to ended
        const updateHuddleQuery = `
          UPDATE huddles
          SET
            status = 'ended',
            ended_at = $1,
            duration_seconds = $2,
            updated_at = $1
          WHERE id = $3
        `;

        await client.query(updateHuddleQuery, [endedAt, durationSeconds, huddleId]);

        // Update all participants left_at timestamp if not already set
        const updateParticipantsQuery = `
          UPDATE huddle_participants
          SET
            left_at = $1,
            updated_at = $1
          WHERE huddle_id = $2 AND left_at IS NULL
        `;

        await client.query(updateParticipantsQuery, [endedAt, huddleId]);

        // Delete the Chime meeting
        const metadata = huddle.metadata;
        if (metadata && metadata.chime_meeting_id) {
          const chimeClient = new ChimeSDKMeetingsClient({
            region: process.env.AWS_REGION || 'us-east-1',
          });

          try {
            const deleteMeetingCommand = new DeleteMeetingCommand({
              MeetingId: metadata.chime_meeting_id,
            });

            await chimeClient.send(deleteMeetingCommand);
          } catch (chimeError) {
            console.error('Failed to delete Chime meeting (non-fatal):', chimeError);
          }
        }

        await client.query('COMMIT');

        const response: EndHuddleResponse = {
          huddle_id: huddleId,
          ended_at: endedAt.toISOString(),
          duration_seconds: durationSeconds,
        };

        return successResponse(response);
      } catch (dbError) {
        await client.query('ROLLBACK');
        console.error('Database error:', dbError);
        return errorResponse('Failed to end huddle', 500);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error ending huddle:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
