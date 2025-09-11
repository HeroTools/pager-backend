import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

interface TranscriptSegment {
  id: string;
  content: string;
  speaker_id?: string;
  speaker_name?: string;
  transcript_timestamp: string;
  created_at: string;
}

interface TranscriptResponse {
  huddle_id: string;
  segments: TranscriptSegment[];
  total_segments: number;
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

      // Verify the user has access to this huddle (was a participant)
      const accessCheckQuery = `
        SELECT h.id
        FROM huddles h
        LEFT JOIN huddle_participants hp ON h.id = hp.huddle_id AND hp.workspace_member_id = $3
        WHERE h.id = $1 AND h.workspace_id = $2 AND (
          h.initiated_by_workspace_member_id = $3 OR hp.id IS NOT NULL
        )
      `;

      const accessResult = await client.query(accessCheckQuery, [huddleId, workspaceId, member.id]);

      if (accessResult.rows.length === 0) {
        return errorResponse('You do not have access to this huddle transcript', 403);
      }

      // Get transcript segments with speaker information
      const getTranscriptQuery = `
        SELECT
          ht.id,
          ht.content,
          ht.speaker_id,
          ht.transcript_timestamp,
          ht.created_at,
          u.name as speaker_name
        FROM huddle_transcripts ht
        LEFT JOIN workspace_members wm ON ht.speaker_id = wm.id
        LEFT JOIN users u ON wm.user_id = u.id
        WHERE ht.huddle_id = $1
        ORDER BY ht.transcript_timestamp ASC, ht.created_at ASC
      `;

      const transcriptResult = await client.query(getTranscriptQuery, [huddleId]);

      const segments: TranscriptSegment[] = transcriptResult.rows.map((row) => ({
        id: row.id,
        content: row.content,
        speaker_id: row.speaker_id,
        speaker_name: row.speaker_name || 'Unknown Speaker',
        transcript_timestamp: row.transcript_timestamp,
        created_at: row.created_at,
      }));

      const response: TranscriptResponse = {
        huddle_id: huddleId,
        segments,
        total_segments: segments.length,
      };

      return successResponse(response);
    } catch (error) {
      console.error('Error getting huddle transcript:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
