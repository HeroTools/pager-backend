-- Add support for multi-user agent conversations

-- Add conversation_type to conversations table
ALTER TABLE conversations 
ADD COLUMN conversation_type VARCHAR DEFAULT 'direct' NOT NULL
CHECK (conversation_type IN ('direct', 'multi_user_agent', 'group'));

-- Add creator_id to track who created multi-user agent conversations
ALTER TABLE conversations
ADD COLUMN creator_workspace_member_id UUID REFERENCES workspace_members(id);

-- Add is_public flag for multi-user agent conversations
ALTER TABLE conversations
ADD COLUMN is_public BOOLEAN DEFAULT false NOT NULL;

-- Add conversation description for multi-user agent conversations
ALTER TABLE conversations 
ADD COLUMN description TEXT;

-- Create a table for conversation invites/join requests
CREATE TABLE IF NOT EXISTS conversation_invites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    invited_by_workspace_member_id UUID NOT NULL REFERENCES workspace_members(id),
    invited_workspace_member_id UUID REFERENCES workspace_members(id),
    invite_code VARCHAR UNIQUE, -- For public invites via link
    expires_at TIMESTAMP WITH TIME ZONE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    
    -- Either invite specific user or create public invite link
    CHECK (
        (invited_workspace_member_id IS NOT NULL AND invite_code IS NULL) OR
        (invited_workspace_member_id IS NULL AND invite_code IS NOT NULL)
    )
);

-- Add indexes for performance
CREATE INDEX idx_conversations_type ON conversations(conversation_type);
CREATE INDEX idx_conversations_public ON conversations(is_public) WHERE is_public = true;
CREATE INDEX idx_conversation_invites_code ON conversation_invites(invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX idx_conversation_invites_conversation ON conversation_invites(conversation_id);

-- Add role field to conversation_members to support different permissions
ALTER TABLE conversation_members 
ADD COLUMN role VARCHAR DEFAULT 'member' NOT NULL
CHECK (role IN ('creator', 'admin', 'member', 'agent'));

-- Add context field for tracking how responses should be grouped
ALTER TABLE messages
ADD COLUMN response_context JSONB;

-- Update existing agent conversations to be single-user type
UPDATE conversations 
SET conversation_type = 'direct'
WHERE id IN (
    SELECT DISTINCT c.id 
    FROM conversations c
    INNER JOIN conversation_members cm ON c.id = cm.conversation_id
    WHERE cm.ai_agent_id IS NOT NULL
);

-- Set creator for existing conversations
UPDATE conversations 
SET creator_workspace_member_id = (
    SELECT cm.workspace_member_id 
    FROM conversation_members cm 
    WHERE cm.conversation_id = conversations.id 
    AND cm.workspace_member_id IS NOT NULL 
    LIMIT 1
)
WHERE creator_workspace_member_id IS NULL;

-- Update existing conversation members to have appropriate roles
UPDATE conversation_members 
SET role = 'agent' 
WHERE ai_agent_id IS NOT NULL;

UPDATE conversation_members 
SET role = 'creator'
WHERE workspace_member_id = (
    SELECT c.creator_workspace_member_id 
    FROM conversations c 
    WHERE c.id = conversation_members.conversation_id
);

COMMENT ON TABLE conversation_invites IS 'Stores invitations for multi-user agent conversations';
COMMENT ON COLUMN conversations.conversation_type IS 'Type of conversation: direct (1-on-1), multi_user_agent (multiple users + agent), group (user-only group)';
COMMENT ON COLUMN conversations.is_public IS 'Whether the multi-user agent conversation can be discovered and joined publicly';
COMMENT ON COLUMN conversation_members.role IS 'Role of the member: creator, admin, member, agent';
COMMENT ON COLUMN messages.response_context IS 'Context for grouping responses in multi-user conversations';