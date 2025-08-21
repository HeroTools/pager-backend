-- Create MCP connections table to store configured MCP servers
CREATE TABLE public.mcp_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  provider character varying NOT NULL, -- 'linear', 'notion', 'github', etc.
  name character varying NOT NULL,
  description text,
  server_url text NOT NULL,
  server_label character varying NOT NULL, -- unique label for OpenAI
  auth_headers jsonb, -- {"Authorization": "Bearer token"}
  require_approval boolean NOT NULL DEFAULT false,
  allowed_tools text[],
  status character varying NOT NULL DEFAULT 'active',
  last_tested_at timestamp with time zone,
  created_by_user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT mcp_connections_pkey PRIMARY KEY (id),
  CONSTRAINT mcp_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id),
  CONSTRAINT mcp_connections_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id),
  CONSTRAINT mcp_connections_workspace_label_unique UNIQUE (workspace_id, server_label)
);

-- Agent MCP access control
CREATE TABLE public.agent_mcp_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  mcp_connection_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT agent_mcp_access_pkey PRIMARY KEY (id),
  CONSTRAINT agent_mcp_access_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE,
  CONSTRAINT agent_mcp_access_mcp_connection_id_fkey FOREIGN KEY (mcp_connection_id) REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  CONSTRAINT agent_mcp_access_unique UNIQUE (agent_id, mcp_connection_id)
);

-- Add indexes for better performance
CREATE INDEX idx_mcp_connections_workspace_id ON public.mcp_connections(workspace_id);
CREATE INDEX idx_mcp_connections_status ON public.mcp_connections(status);
CREATE INDEX idx_agent_mcp_access_agent_id ON public.agent_mcp_access(agent_id);
CREATE INDEX idx_agent_mcp_access_mcp_connection_id ON public.agent_mcp_access(mcp_connection_id);

-- Add RLS policies
ALTER TABLE public.mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mcp_access ENABLE ROW LEVEL SECURITY;

-- Policy for mcp_connections: users can only access connections in their workspaces
CREATE POLICY "Users can view MCP connections in their workspaces" ON public.mcp_connections
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM public.members 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Users can insert MCP connections in their workspaces" ON public.mcp_connections
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.members 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Users can update MCP connections in their workspaces" ON public.mcp_connections
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM public.members 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "Users can delete MCP connections in their workspaces" ON public.mcp_connections
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM public.members 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Policy for agent_mcp_access: users can only access agents in their workspaces
CREATE POLICY "Users can view agent MCP access in their workspaces" ON public.agent_mcp_access
  FOR SELECT USING (
    agent_id IN (
      SELECT a.id FROM public.agents a
      JOIN public.members m ON a.workspace_id = m.workspace_id
      WHERE m.user_id = auth.uid() AND m.status = 'active'
    )
  );

CREATE POLICY "Users can insert agent MCP access in their workspaces" ON public.agent_mcp_access
  FOR INSERT WITH CHECK (
    agent_id IN (
      SELECT a.id FROM public.agents a
      JOIN public.members m ON a.workspace_id = m.workspace_id
      WHERE m.user_id = auth.uid() AND m.status = 'active'
    )
  );

CREATE POLICY "Users can update agent MCP access in their workspaces" ON public.agent_mcp_access
  FOR UPDATE USING (
    agent_id IN (
      SELECT a.id FROM public.agents a
      JOIN public.members m ON a.workspace_id = m.workspace_id
      WHERE m.user_id = auth.uid() AND m.status = 'active'
    )
  );

CREATE POLICY "Users can delete agent MCP access in their workspaces" ON public.agent_mcp_access
  FOR DELETE USING (
    agent_id IN (
      SELECT a.id FROM public.agents a
      JOIN public.members m ON a.workspace_id = m.workspace_id
      WHERE m.user_id = auth.uid() AND m.status = 'active'
    )
  );