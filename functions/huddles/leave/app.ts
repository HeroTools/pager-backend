import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

interface LeaveHuddleResponse {
  success: boolean;
  huddle_ended?: boolean;
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

        // Get huddle details and participant info
        const getHuddleQuery = `
          SELECT
            h.id,
            h.status,
            hp.id as participant_id,
            hp.role,
            (SELECT COUNT(*) FROM huddle_participants hp2
             WHERE hp2.huddle_id = h.id AND hp2.left_at IS NULL) as active_participant_count
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

        if (!huddle.participant_id) {
          return errorResponse('You are not a participant in this huddle', 400);
        }

        const leftAt = new Date();
        let huddleEnded = false;

        // Update participant's left_at timestamp
        const updateParticipantQuery = `
          UPDATE huddle_participants
          SET
            left_at = $1,
            updated_at = $1
          WHERE id = $2
        `;

        await client.query(updateParticipantQuery, [leftAt, huddle.participant_id]);

        // Check if this was the last active participant
        if (huddle.active_participant_count <= 1) {
          // End the huddle if this was the last participant
          const endedAt = new Date();
          const getHuddleStartQuery = `SELECT started_at FROM huddles WHERE id = $1`;
          const startResult = await client.query(getHuddleStartQuery, [huddleId]);

          const durationSeconds = Math.floor(
            (endedAt.getTime() - new Date(startResult.rows[0].started_at).getTime()) / 1000,
          );

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
          huddleEnded = true;
        }

        await client.query('COMMIT');

        const response: LeaveHuddleResponse = {
          success: true,
          huddle_ended: huddleEnded,
        };

        return successResponse(response);
      } catch (dbError) {
        await client.query('ROLLBACK');
        console.error('Database error:', dbError);
        return errorResponse('Failed to leave huddle', 500);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error leaving huddle:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
