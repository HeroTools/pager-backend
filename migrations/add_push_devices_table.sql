-- Create push_devices table for storing device push tokens
CREATE TABLE IF NOT EXISTS push_devices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    push_token TEXT NOT NULL,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
    device_name TEXT,
    device_model TEXT,
    os_version TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique token per user
    UNIQUE(user_id, push_token)
);

-- Create indexes for performance
CREATE INDEX idx_push_devices_user_id ON push_devices(user_id);
CREATE INDEX idx_push_devices_token ON push_devices(push_token);
CREATE INDEX idx_push_devices_active ON push_devices(is_active) WHERE is_active = true;

-- Create function to clean up old inactive devices
CREATE OR REPLACE FUNCTION cleanup_inactive_devices()
RETURNS void AS $$
BEGIN
    -- Deactivate devices not seen in 30 days
    UPDATE push_devices
    SET is_active = false
    WHERE last_seen_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
    AND is_active = true;
    
    -- Delete devices not seen in 90 days
    DELETE FROM push_devices
    WHERE last_seen_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON TABLE push_devices IS 'Stores push notification tokens for mobile devices';