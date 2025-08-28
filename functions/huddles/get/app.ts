import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import dbPool from '../../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';

interface HuddleDetails {
  id: string;
  workspace_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  title: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  initiated_by: {
    id: string;
    name: string;
  };
  participants: Array<{
    id: string;
    workspace_member_id: string;
    role: string;
    joined_at: string;
    left_at: string | null;
    user: {
      name: string;
    };
  }>;
  transcript_summary?: {
    total_segments: number;
    has_embeddings: boolean;
  };
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
        // Get huddle details with initiator info
        const getHuddleQuery = `
          SELECT 
            h.id,
            h.workspace_id,
            h.channel_id,
            h.conversation_id,
            h.title,
            h.status,
            h.started_at,
            h.ended_at,
            h.duration_seconds,
            h.initiated_by_workspace_member_id,
            u.name as initiated_by_name
          FROM huddles h
          JOIN workspace_members wm ON h.initiated_by_workspace_member_id = wm.id
          JOIN users u ON wm.user_id = u.id
          WHERE h.id = $1 AND h.workspace_id = $2
        `;

        const huddleResult = await client.query(getHuddleQuery, [huddleId, workspaceId]);

        if (huddleResult.rows.length === 0) {
          return errorResponse('Huddle not found', 404);
        }

        const huddle = huddleResult.rows[0];

        // Get participants
        const getParticipantsQuery = `
          SELECT 
            hp.id,
            hp.workspace_member_id,
            hp.role,
            hp.joined_at,
            hp.left_at,
            u.name as user_name
          FROM huddle_participants hp
          JOIN workspace_members wm ON hp.workspace_member_id = wm.id
          JOIN users u ON wm.user_id = u.id
          WHERE hp.huddle_id = $1
          ORDER BY hp.joined_at ASC
        `;

        const participantsResult = await client.query(getParticipantsQuery, [huddleId]);

        // Get transcript summary
        const getTranscriptSummaryQuery = `
          SELECT 
            COUNT(ht.id) as total_segments,
            COUNT(he.id) as segments_with_embeddings
          FROM huddle_transcripts ht
          LEFT JOIN huddle_embeddings he ON ht.id = he.transcript_id
          WHERE ht.huddle_id = $1
        `;

        const transcriptSummaryResult = await client.query(getTranscriptSummaryQuery, [huddleId]);
        const transcriptSummary = transcriptSummaryResult.rows[0];

        const huddleDetails: HuddleDetails = {
          id: huddle.id,
          workspace_id: huddle.workspace_id,
          channel_id: huddle.channel_id,
          conversation_id: huddle.conversation_id,
          title: huddle.title,
          status: huddle.status,
          started_at: huddle.started_at,
          ended_at: huddle.ended_at,
          duration_seconds: huddle.duration_seconds,
          initiated_by: {
            id: huddle.initiated_by_workspace_member_id,
            name: huddle.initiated_by_name
          },
          participants: participantsResult.rows.map(p => ({
            id: p.id,
            workspace_member_id: p.workspace_member_id,
            role: p.role,
            joined_at: p.joined_at,
            left_at: p.left_at,
            user: {
              name: p.user_name
            }
          })),
          transcript_summary: {
            total_segments: parseInt(transcriptSummary.total_segments) || 0,
            has_embeddings: parseInt(transcriptSummary.segments_with_embeddings) > 0
          }
        };

        return successResponse(huddleDetails);

      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error getting huddle details:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);