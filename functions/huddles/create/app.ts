import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChimeSDKMeetingsClient, CreateMeetingCommand, CreateAttendeeCommand } from '@aws-sdk/client-chime-sdk-meetings';
import { TranscribeClient, StartMeetingTranscriptionCommand } from '@aws-sdk/client-transcribe';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import dbPool from '../../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';

interface CreateHuddleRequest {
  workspace_id: string;
  channel_id?: string;
  conversation_id?: string;
  title?: string;
}

interface CreateHuddleResponse {
  huddle: {
    id: string;
    workspace_id: string;
    title: string;
    status: string;
    started_at: string;
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
  attendee: {
    attendee_id: string;
    join_token: string;
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
      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      const body: CreateHuddleRequest = JSON.parse(event.body || '{}');
      const { channel_id, conversation_id, title } = body;

      if (!channel_id && !conversation_id) {
        return errorResponse('Either channel_id or conversation_id is required', 400);
      }

      const member = await getMember(workspaceId, userId);
      if (!member) {
        return errorResponse('Not a member of this workspace', 403);
      }

      // Initialize Chime SDK client
      const chimeClient = new ChimeSDKMeetingsClient({ region: process.env.AWS_REGION || 'us-east-2' });
      
      // Create a Chime meeting
      const meetingId = `huddle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const createMeetingCommand = new CreateMeetingCommand({
        ClientRequestToken: meetingId,
        MediaRegion: process.env.AWS_REGION || 'us-east-2',
        ExternalMeetingId: meetingId,
        MeetingFeatures: {
          Audio: {
            EchoReduction: 'AVAILABLE'
          }
        },
        Tags: [
          {
            Key: 'workspace_id',
            Value: workspaceId
          },
          {
            Key: 'initiated_by',
            Value: member.id
          }
        ]
      });

      const meetingResponse = await chimeClient.send(createMeetingCommand);
      
      if (!meetingResponse.Meeting) {
        return errorResponse('Failed to create Chime meeting', 500);
      }

      // Create an attendee for the initiator
      const createAttendeeCommand = new CreateAttendeeCommand({
        MeetingId: meetingResponse.Meeting.MeetingId!,
        ExternalUserId: member.id,
        Capabilities: {
          Audio: 'SendReceive',
          Video: 'None'
        }
      });

      const attendeeResponse = await chimeClient.send(createAttendeeCommand);
      
      if (!attendeeResponse.Attendee) {
        return errorResponse('Failed to create attendee', 500);
      }

      // Start transcription for the meeting
      const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION || 'us-east-2' });
      const startTranscriptionCommand = new StartMeetingTranscriptionCommand({
        MeetingId: meetingResponse.Meeting.MeetingId!,
        TranscriptionConfiguration: {
          EngineTranscribeSettings: {
            LanguageCode: 'en-US',
            ShowSpeakerLabels: true,
            MaxSpeakerLabels: 10,
            VocabularyFilterMethod: 'remove'
          }
        }
      });

      try {
        await transcribeClient.send(startTranscriptionCommand);
      } catch (transcribeError) {
        console.error('Failed to start transcription (non-fatal):', transcribeError);
      }

      // Insert huddle record into database
      client = await dbPool.connect();
      try {
        await client.query('BEGIN');

        const insertHuddleQuery = `
          INSERT INTO huddles (
            workspace_id,
            channel_id,
            conversation_id,
            initiated_by_workspace_member_id,
            title,
            status,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, created_at
        `;

        const huddleMetadata = {
          chime_meeting_id: meetingResponse.Meeting.MeetingId,
          media_region: meetingResponse.Meeting.MediaRegion,
          external_meeting_id: meetingId
        };

        const huddleResult = await client.query(insertHuddleQuery, [
          workspaceId,
          channel_id || null,
          conversation_id || null,
          member.id,
          title || 'Huddle',
          'active',
          JSON.stringify(huddleMetadata)
        ]);

        const huddleId = huddleResult.rows[0].id;

        // Add the initiator as a participant
        const insertParticipantQuery = `
          INSERT INTO huddle_participants (
            huddle_id,
            workspace_member_id,
            role
          ) VALUES ($1, $2, $3)
        `;

        await client.query(insertParticipantQuery, [
          huddleId,
          member.id,
          'host'
        ]);

        await client.query('COMMIT');

        const response: CreateHuddleResponse = {
          huddle: {
            id: huddleId,
            workspace_id: workspaceId,
            title: title || 'Huddle',
            status: 'active',
            started_at: huddleResult.rows[0].created_at
          },
          meeting: {
            meeting_id: meetingResponse.Meeting.MeetingId!,
            media_region: meetingResponse.Meeting.MediaRegion!,
            media_placement: {
              audio_host_url: meetingResponse.Meeting.MediaPlacement!.AudioHostUrl!,
              audio_fallback_url: meetingResponse.Meeting.MediaPlacement!.AudioFallbackUrl!,
              signaling_url: meetingResponse.Meeting.MediaPlacement!.SignalingUrl!,
              turn_control_url: meetingResponse.Meeting.MediaPlacement!.TurnControlUrl!
            }
          },
          attendee: {
            attendee_id: attendeeResponse.Attendee.AttendeeId!,
            join_token: attendeeResponse.Attendee.JoinToken!
          }
        };

        return successResponse(response);

      } catch (dbError) {
        await client.query('ROLLBACK');
        console.error('Database error:', dbError);
        return errorResponse('Failed to create huddle', 500);
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error creating huddle:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);