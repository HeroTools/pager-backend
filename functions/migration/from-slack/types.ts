export interface DirectMessage {
  participants: string[];
  folderName: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile: {
    email?: string;
    display_name?: string;
  };
  deleted?: boolean;
  is_bot?: boolean;
}

export interface SlackChannel {
  id: string;
  name: string;
  purpose?: { value: string };
  is_private?: boolean;
  members?: string[];
}

export interface SlackMessage {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reactions?: Array<{
    name: string;
    users: string[];
  }>;
}

export interface MigrationJob {
  jobId: string;
  workspaceId: string;
  userId: string;
  storageKey: string;
  filename: string;
  fileSize: number;
}
