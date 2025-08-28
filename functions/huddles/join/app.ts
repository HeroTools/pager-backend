import { ChimeSDKMeetingsClient, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

interface JoinHuddleResponse {
  attendee: {
    attendee_id: string;
    join_token: string;
  };
  meeting: {
    meeting_id: string;
    media_region: string;
    media_placement: {
      audio_host_url: string;
      audio_fallback_url: string;
      signaling_url: string;
      turn_control_url: string;
    };
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
        // Get huddle details and verify it exists and is active
        const getHuddleQuery = `
          SELECT
            h.id,
            h.status,
            h.metadata,
            hp.id as participant_id
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

        const metadata = huddle.metadata;
        if (!metadata || !metadata.chime_meeting_id) {
          return errorResponse('Invalid huddle configuration', 500);
        }

        // Add user as participant if not already added
        if (!huddle.participant_id) {
          const insertParticipantQuery = `
            INSERT INTO huddle_participants (
              huddle_id,
              workspace_member_id,
              role
            ) VALUES ($1, $2, $3)
            ON CONFLICT (huddle_id, workspace_member_id) DO NOTHING
          `;

          await client.query(insertParticipantQuery, [huddleId, member.id, 'participant']);
        }

        // Create Chime attendee
        const chimeClient = new ChimeSDKMeetingsClient({
          region: process.env.AWS_REGION || 'us-east-1',
        });

        const createAttendeeCommand = new CreateAttendeeCommand({
          MeetingId: metadata.chime_meeting_id,
          ExternalUserId: member.id,
          Capabilities: {
            Audio: 'SendReceive',
            Video: 'SendReceive',
            Content: 'SendReceive',
          },
        });

        const attendeeResponse = await chimeClient.send(createAttendeeCommand);

        if (!attendeeResponse.Attendee) {
          return errorResponse('Failed to create attendee', 500);
        }

        // Get meeting details for the response
        const response: JoinHuddleResponse = {
          attendee: {
            attendee_id: attendeeResponse.Attendee.AttendeeId!,
            join_token: attendeeResponse.Attendee.JoinToken!,
          },
          meeting: {
            meeting_id: metadata.chime_meeting_id,
            media_region: metadata.media_region,
            media_placement: {
              audio_host_url: metadata.audio_host_url,
              audio_fallback_url: metadata.audio_fallback_url,
              signaling_url: metadata.signaling_url,
              turn_control_url: metadata.turn_control_url,
            },
          },
        };

        return successResponse(response);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error joining huddle:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
