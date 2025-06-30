import { PoolClient } from 'pg';

/**
 * Extract user mentions from message body
 */
export function extractMentions(messageBody: string): string[] {
    if (!messageBody) return [];

    // Match @userId (UUID pattern) and @username patterns
    const mentionRegex = /@([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[\w.-]+)/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(messageBody)) !== null) {
        mentions.push(match[1]);
    }

    return [...new Set(mentions)]; // Remove duplicates
}

/**
 * Resolve mentions to actual user IDs
 */
export async function resolveMentions(client: PoolClient, mentions: string[], workspaceId: string): Promise<string[]> {
    if (mentions.length === 0) return [];

    const query = `
        SELECT DISTINCT u.id
        FROM users u
        JOIN workspace_members wm ON u.id = wm.user_id
        WHERE wm.workspace_id = $1 
          AND wm.is_deactivated = false
          AND (
            u.id = ANY($2) OR 
            u.name ILIKE ANY($3) OR 
            u.email ILIKE ANY($4)
          )
    `;

    const usernamePatterns = mentions.map((m) => `%${m}%`);
    const emailPatterns = mentions.map((m) => `%${m}%`);

    const { rows } = await client.query(query, [workspaceId, mentions, usernamePatterns, emailPatterns]);
    return rows.map((row) => row.id);
}

/**
 * Extract and resolve mentions in one step
 */
export async function extractAndResolveMentions(
    client: PoolClient,
    messageBody: string,
    workspaceId: string,
): Promise<string[]> {
    const mentions = extractMentions(messageBody);
    return await resolveMentions(client, mentions, workspaceId);
}
