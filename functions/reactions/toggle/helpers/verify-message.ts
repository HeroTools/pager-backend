async function verifyMessageInWorkspace(
  client: any,
  messageId: string,
  workspaceId: string,
): Promise<boolean> {
  const result = await client.query(`SELECT id FROM messages WHERE id = $1 AND workspace_id = $2`, [
    messageId,
    workspaceId,
  ]);
  return result.rows.length > 0;
}

export { verifyMessageInWorkspace };
