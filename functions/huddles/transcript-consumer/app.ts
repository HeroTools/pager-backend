import { EventBridgeEvent } from 'aws-lambda';
import dbPool from '../../../common/utils/create-db-pool';

interface TranscriptEvent {
  version: string;
  id: string;
  'detail-type': string;
  source: string;
  account: string;
  time: string;
  region: string;
  detail: {
    meetingId: string;
    transcriptionEvent: {
      type: 'TRANSCRIPT' | 'SPEAKER_CHANGE' | 'END';
      transcript?: {
        id: string;
        content: string;
        speakerId?: string;
        confidence: number;
        startTime: number;
        endTime: number;
        isPartial: boolean;
      };
      speakerChange?: {
        speakerId: string;
        timestamp: number;
      };
    };
  };
}

interface TranscriptSegment {
  content: string;
  speaker_id?: string;
  timestamp: Date;
  confidence?: number;
}

export const handler = async (
  event: EventBridgeEvent<string, TranscriptEvent['detail']>,
): Promise<void> => {
  let client;

  try {
    console.log('Received transcription event:', JSON.stringify(event, null, 2));

    const { meetingId, transcriptionEvent } = event.detail;

    if (!meetingId || !transcriptionEvent) {
      console.warn('Invalid transcription event structure');
      return;
    }

    // Only process actual transcript content, not speaker changes or end events
    if (transcriptionEvent.type !== 'TRANSCRIPT' || !transcriptionEvent.transcript) {
      console.log(`Skipping non-transcript event of type: ${transcriptionEvent.type}`);
      return;
    }

    const transcript = transcriptionEvent.transcript;

    // Skip partial transcripts to avoid duplicates - only process final transcripts
    if (transcript.isPartial) {
      console.log('Skipping partial transcript');
      return;
    }

    client = await dbPool.connect();
    try {
      // Find the huddle by Chime meeting ID
      const findHuddleQuery = `
        SELECT id, workspace_id
        FROM huddles
        WHERE metadata->>'chime_meeting_id' = $1
        AND status = 'active'
      `;

      const huddleResult = await client.query(findHuddleQuery, [meetingId]);

      if (huddleResult.rows.length === 0) {
        console.warn(`No active huddle found for meeting ID: ${meetingId}`);
        return;
      }

      const huddle = huddleResult.rows[0];

      // Try to map speaker ID to workspace member if possible
      let workspaceMemberId = null;
      if (transcript.speakerId) {
        // In a real implementation, you might have a mapping between Chime attendee IDs
        // and workspace member IDs. For now, we'll check if the speaker ID matches
        // any participant's external user ID pattern
        const speakerMappingQuery = `
          SELECT workspace_member_id
          FROM huddle_participants hp
          WHERE hp.huddle_id = $1
          -- This would need to be implemented based on how you store the mapping
          -- between Chime attendee IDs and workspace members
        `;

        try {
          // For now, we'll leave speaker_id null and let the frontend handle speaker identification
          // In a full implementation, you'd maintain a mapping table or use the external user ID
          // that was set when creating the attendee
        } catch (speakerError) {
          console.warn('Could not map speaker ID to workspace member:', speakerError);
        }
      }

      // Insert transcript segment
      const insertTranscriptQuery = `
        INSERT INTO huddle_transcripts (
          huddle_id,
          speaker_id,
          content,
          transcript_timestamp
        ) VALUES ($1, $2, $3, $4)
        RETURNING id
      `;

      const transcriptTimestamp = new Date(transcript.startTime);

      const insertResult = await client.query(insertTranscriptQuery, [
        huddle.id,
        workspaceMemberId,
        transcript.content,
        transcriptTimestamp,
      ]);

      const transcriptId = insertResult.rows[0].id;

      console.log(
        `Successfully inserted transcript segment ${transcriptId} for huddle ${huddle.id}`,
      );

      // Optional: Trigger embedding generation for this transcript segment
      // You could add this transcript to a queue for embedding processing
      // or trigger the embedding generator Lambda directly
    } catch (dbError) {
      console.error('Database error processing transcript:', dbError);
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing transcription event:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};
