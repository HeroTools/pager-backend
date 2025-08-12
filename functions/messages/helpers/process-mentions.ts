import { PoolClient } from 'pg';

export interface MentionData {
  memberId: string;
  entityType: 'user'; // future: 'group', 'everyone', etc.
}

export function extractMentionsFromDelta(deltaOps: any[]): MentionData[] {
  if (!Array.isArray(deltaOps)) return [];

  const mentions: MentionData[] = [];
  const seenMemberIds = new Set<string>();

  for (const op of deltaOps) {
    if (op.insert && typeof op.insert === 'object' && op.insert.mention) {
      const memberId = op.insert.mention.id;
      if (memberId && typeof memberId === 'string' && !seenMemberIds.has(memberId)) {
        mentions.push({
          memberId,
          entityType: 'user',
        });
        seenMemberIds.add(memberId);
      }
    }
  }

  return mentions;
}

export async function processMentions(
  client: PoolClient,
  messageId: string,
  workspaceId: string,
  deltaOps: any[] | null,
): Promise<string[]> {
  if (!deltaOps || deltaOps.length === 0) {
    return [];
  }

  const mentions = extractMentionsFromDelta(deltaOps);
  if (mentions.length === 0) {
    return [];
  }

  const mentionedMemberIds = [...new Set(mentions.map((m) => m.memberId))];

  const validateMentionsQuery = `
    SELECT id
    FROM workspace_members
    WHERE workspace_id = $1
      AND id = ANY($2)
      AND is_deactivated = false
  `;

  const { rows: validMembers } = await client.query(validateMentionsQuery, [
    workspaceId,
    mentionedMemberIds,
  ]);

  const validMemberIds = new Set(validMembers.map((m) => m.id));
  const validMentions = mentions.filter((m) => validMemberIds.has(m.memberId));

  if (mentions.length > validMentions.length) {
    console.log(
      `Filtered out ${mentions.length - validMentions.length} invalid mentions for message ${messageId}`,
    );
  }

  if (validMentions.length > 0) {
    const mentionValues: string[] = [];
    const mentionParams: any[] = [];
    let paramIndex = 1;

    const validWorkspaceMemberIds = validMentions.map((mention) => {
      mentionValues.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`,
      );
      mentionParams.push(messageId, mention.memberId, mention.entityType, workspaceId);
      paramIndex += 4;
      return mention.memberId;
    });

    const insertMentionsQuery = `
      INSERT INTO message_mentions (message_id, mentioned_entity_id, mentioned_entity_type, workspace_id)
      VALUES ${mentionValues.join(', ')}
      ON CONFLICT (message_id, mentioned_entity_id, mentioned_entity_type) DO NOTHING
    `;
    await client.query(insertMentionsQuery, mentionParams);

    return validWorkspaceMemberIds;
  }

  return [];
}
