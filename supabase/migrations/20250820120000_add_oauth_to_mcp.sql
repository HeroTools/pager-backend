-- Add OAuth support to MCP connections
ALTER TABLE public.mcp_connections 
ADD COLUMN oauth_config jsonb,
ADD COLUMN auth_state varchar(255);

-- Update status enum to include pending_auth
ALTER TABLE public.mcp_connections 
DROP CONSTRAINT IF EXISTS mcp_connections_status_check;

ALTER TABLE public.mcp_connections 
ADD CONSTRAINT mcp_connections_status_check 
CHECK (status IN ('active', 'inactive', 'error', 'pending_auth'));

-- Create OAuth state tracking table for security
CREATE TABLE public.mcp_oauth_states (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  state varchar(255) NOT NULL,
  provider varchar(50) NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes'),
  CONSTRAINT mcp_oauth_states_pkey PRIMARY KEY (id),
  CONSTRAINT mcp_oauth_states_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.mcp_connections(id) ON DELETE CASCADE,
  CONSTRAINT mcp_oauth_states_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id),
  CONSTRAINT mcp_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT mcp_oauth_states_state_unique UNIQUE (state)
);

-- Add indexes
CREATE INDEX idx_mcp_oauth_states_state ON public.mcp_oauth_states(state);
CREATE INDEX idx_mcp_oauth_states_connection_id ON public.mcp_oauth_states(connection_id);
CREATE INDEX idx_mcp_oauth_states_expires_at ON public.mcp_oauth_states(expires_at);

-- Add RLS for OAuth states
ALTER TABLE public.mcp_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their OAuth states" ON public.mcp_oauth_states
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert their OAuth states" ON public.mcp_oauth_states
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their OAuth states" ON public.mcp_oauth_states
  FOR DELETE USING (user_id = auth.uid());

-- Clean up expired OAuth states automatically
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void AS $$
BEGIN
  DELETE FROM public.mcp_oauth_states 
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup (if you have pg_cron extension)
-- SELECT cron.schedule('cleanup-oauth-states', '*/5 * * * *', 'SELECT cleanup_expired_oauth_states();');