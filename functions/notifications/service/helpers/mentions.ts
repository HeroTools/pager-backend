import { PoolClient } from 'pg';

export function extractMentions(messageBody: string): string[] {
  if (!messageBody) return [];

  const mentionRegex = /<@([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})>/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(messageBody)) !== null) {
    mentions.push(match[1]);
  }

  return [...new Set(mentions)];
}

export async function resolveMentions(
  client: PoolClient,
  workspaceMemberIds: string[],
  workspaceId: string,
): Promise<string[]> {
  if (workspaceMemberIds.length === 0) return [];

  const query = `
    SELECT DISTINCT wm.id
    FROM workspace_members wm
    WHERE wm.workspace_id = $1 
      AND wm.is_deactivated = false
      AND wm.id = ANY($2)
  `;

  const { rows } = await client.query(query, [workspaceId, workspaceMemberIds]);
  return rows.map((row) => row.id);
}

export async function extractAndResolveMentions(
  client: PoolClient,
  messageBody: string,
  workspaceId: string,
): Promise<string[]> {
  const mentions = extractMentions(messageBody);
  return resolveMentions(client, mentions, workspaceId);
}
