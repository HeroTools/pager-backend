import AdmZip from 'adm-zip';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { convertShortcodeToEmoji } from '../../common/helpers/get-emoji';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import dbPool from '../../common/utils/create-db-pool';
import { supabase } from '../../common/utils/supabase-client';
import { DirectMessage, MigrationJob, SlackChannel, SlackMessage, SlackUser } from './types';

interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: {
    usersCreated: number;
    channelsCreated: number;
    conversationsCreated: number;
    messagesImported: number;
    reactionsAdded: number;
  };
  error?: string;
  completedAt?: string;
}

class ResilientSlackMigrator {
  private client: any;
  private userMapping = new Map<string, string>();
  private channelMapping = new Map<string, string>();
  private conversationMapping = new Map<string, string>();
  private messageMapping = new Map<string, string>();
  private workspaceId: string;
  private currentUserId: string;
  private stats = {
    usersCreated: 0,
    channelsCreated: 0,
    conversationsCreated: 0,
    messagesImported: 0,
    reactionsAdded: 0,
    errors: [] as string[],
  };
  private jobId: string;

  // Performance limits to prevent DB blocking
  private readonly BATCH_CHECK_SIZE = 500; // Max timestamps per batch query
  private readonly TRANSACTION_CHUNK_SIZE = 100; // Max messages per transaction
  private readonly MESSAGE_PROCESSING_DELAY = 50; // ms delay between chunks
  private readonly MAX_RETRIES = 3;

  constructor(client: any, workspaceId: string, currentUserId: string, jobId: string) {
    this.client = client;
    this.workspaceId = workspaceId;
    this.currentUserId = currentUserId;
    this.jobId = jobId;
  }

  async migrateFromStream(zipStream: Readable, fileSize: number) {
    try {
      console.log(
        `Starting chunked migration for workspace: ${this.workspaceId}, size: ${fileSize} bytes`,
      );

      // Process file
      const chunks: Buffer[] = [];
      for await (const chunk of zipStream) {
        chunks.push(chunk as Buffer);
      }

      const zipBuffer = Buffer.concat(chunks);
      console.log(`Loaded ${zipBuffer.length} bytes into memory`);

      const zip = new AdmZip(zipBuffer);
      return await this.processZipEntriesResilient(zip);
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  }

  private async processZipEntriesResilient(zip: AdmZip) {
    const entries = zip.getEntries();

    // Find users.json and channels.json
    const usersEntry = entries.find((e) => e.entryName === 'users.json');
    const channelsEntry = entries.find((e) => e.entryName === 'channels.json');

    if (!usersEntry || !channelsEntry) {
      throw new Error('Invalid Slack export: missing users.json or channels.json');
    }

    const users: SlackUser[] = JSON.parse(usersEntry.getData().toString()).filter(
      (u: SlackUser) => !u.is_bot,
    );
    const channels: SlackChannel[] = JSON.parse(channelsEntry.getData().toString());

    // Find direct message folders (these become conversations)
    const directMessages = this.findDirectMessages(zip, users);

    console.log(
      `Found ${users.length} users, ${channels.length} channels, and ${directMessages.length} direct message conversations`,
    );

    // Migrate users (with progress updates)
    await this.migrateUsersResilient(users);
    await this.updateProgress();

    // Migrate channels (with progress updates)
    await this.migrateChannelsResilient(channels);
    await this.updateProgress();

    // Migrate direct messages as conversations
    await this.migrateDirectMessagesResilient(zip, directMessages);
    await this.updateProgress();

    // Migrate messages (with chunked processing)
    await this.migrateMessagesResilient(zip, channels);
    await this.updateProgress();

    console.log('Migration completed:', this.stats);
    return this.stats;
  }

  private async updateProgress() {
    try {
      await updateJobStatus(this.jobId, {
        progress: {
          usersCreated: this.stats.usersCreated,
          channelsCreated: this.stats.channelsCreated,
          conversationsCreated: this.stats.conversationsCreated,
          messagesImported: this.stats.messagesImported,
          reactionsAdded: this.stats.reactionsAdded,
        },
      });
    } catch (error) {
      console.warn('Failed to update progress:', error.message);
    }
  }

  private async migrateUsersResilient(users: SlackUser[]) {
    console.log('Migrating users with chunking...');

    // Process users in small batches to avoid blocking
    const BATCH_SIZE = 10;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const userBatch = users.slice(i, i + BATCH_SIZE);

      for (const user of userBatch) {
        try {
          // Each user gets its own transaction
          await this.client.query('BEGIN');
          await this.migrateUserWithAuth(user);
          await this.client.query('COMMIT');
          this.stats.usersCreated++;
        } catch (error) {
          await this.client.query('ROLLBACK');
          this.stats.errors.push(`User ${user.name}: ${error.message}`);
          console.warn(`Failed to migrate user ${user.name}:`, error.message);
        }
      }

      // Small delay to prevent overwhelming the DB
      if (i + BATCH_SIZE < users.length) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async migrateChannelsResilient(channels: SlackChannel[]) {
    console.log('Migrating channels with chunking...');

    for (const channel of channels) {
      try {
        // Each channel gets its own transaction
        await this.client.query('BEGIN');
        await this.migrateChannel(channel);
        await this.client.query('COMMIT');
        this.stats.channelsCreated++;
      } catch (error) {
        await this.client.query('ROLLBACK');
        this.stats.errors.push(`Channel ${channel.name}: ${error.message}`);
        console.warn(`Failed to migrate channel ${channel.name}:`, error.message);
      }
    }
  }

  private async migrateMessagesResilient(zip: AdmZip, channels: SlackChannel[]) {
    console.log('Migrating messages with chunked processing...');

    for (const channel of channels) {
      const channelId = this.channelMapping.get(channel.id);
      if (!channelId) continue;

      try {
        await this.processChannelMessages(zip, channel, channelId);
        console.log(`Completed migration for channel: ${channel.name}`);
      } catch (error) {
        console.warn(`Failed to migrate messages for channel ${channel.name}:`, error.message);
        this.stats.errors.push(`Channel messages ${channel.name}: ${error.message}`);
      }
    }
  }

  private async processChannelMessages(zip: AdmZip, channel: SlackChannel, channelId: string) {
    // Load all messages for this channel
    const channelEntries = zip
      .getEntries()
      .filter((e) => e.entryName.startsWith(`${channel.name}/`) && e.entryName.endsWith('.json'));

    let allChannelMessages: SlackMessage[] = [];

    for (const entry of channelEntries) {
      try {
        const dailyMessages = JSON.parse(entry.getData().toString());
        allChannelMessages.push(...dailyMessages);
      } catch (e) {
        console.warn(`Failed to parse ${entry.entryName}`);
      }
    }

    const sortedMessages = allChannelMessages
      .filter((m) => m.type === 'message' && m.user)
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    if (sortedMessages.length === 0) {
      console.log(`No messages found for channel: ${channel.name}`);
      return;
    }

    console.log(`Processing ${sortedMessages.length} messages for channel: ${channel.name}`);

    // Process messages in chunks to prevent long transactions
    for (let i = 0; i < sortedMessages.length; i += this.TRANSACTION_CHUNK_SIZE) {
      const messageChunk = sortedMessages.slice(i, i + this.TRANSACTION_CHUNK_SIZE);

      await this.processMessageChunk(messageChunk, channelId, channel.name, i);

      // Small delay between chunks to prevent DB overload
      if (i + this.TRANSACTION_CHUNK_SIZE < sortedMessages.length) {
        await new Promise((resolve) => setTimeout(resolve, this.MESSAGE_PROCESSING_DELAY));
      }

      // Update progress periodically
      if (i > 0 && i % 500 === 0) {
        await this.updateProgress();
      }
    }
  }

  private async processMessageChunk(
    messageChunk: SlackMessage[],
    channelId: string,
    channelName: string,
    chunkStart: number,
  ) {
    let retries = 0;

    while (retries < this.MAX_RETRIES) {
      try {
        await this.client.query('BEGIN');

        // Batch check existing messages in smaller batches
        const existingTimestamps = new Set<string>();

        for (let j = 0; j < messageChunk.length; j += this.BATCH_CHECK_SIZE) {
          const timestampBatch = messageChunk.slice(j, j + this.BATCH_CHECK_SIZE).map((m) => m.ts);

          if (timestampBatch.length === 0) continue;

          const { rows: existing } = await this.client.query(
            `SELECT metadata->>'slack_ts' as slack_ts, id FROM messages
             WHERE workspace_id = $1 AND channel_id = $2 AND metadata->>'slack_ts' = ANY($3)`,
            [this.workspaceId, channelId, timestampBatch],
          );

          existing.forEach((row) => {
            existingTimestamps.add(row.slack_ts);
            this.messageMapping.set(row.slack_ts, row.id);
          });
        }

        // Process messages in this chunk, skipping existing ones
        let newMessagesInChunk = 0;
        for (const message of messageChunk) {
          if (!existingTimestamps.has(message.ts)) {
            try {
              await this.migrateMessage(message, channelId);
              newMessagesInChunk++;
            } catch (msgError) {
              console.warn(
                `Failed to migrate individual message in ${channelName}:`,
                msgError.message,
              );
            }
          }
        }

        // Process reactions for all messages in chunk
        for (const message of messageChunk) {
          if (message.reactions) {
            try {
              await this.migrateReactions(message);
            } catch (reactionError) {
              console.warn(`Failed to migrate reactions for message:`, reactionError.message);
            }
          }
        }

        await this.client.query('COMMIT');

        const chunkNum = Math.floor(chunkStart / this.TRANSACTION_CHUNK_SIZE) + 1;
        console.log(
          `Chunk ${chunkNum} for ${channelName}: ${newMessagesInChunk}/${messageChunk.length} new messages`,
        );

        break; // Success, exit retry loop
      } catch (error) {
        await this.client.query('ROLLBACK');
        retries++;

        if (retries >= this.MAX_RETRIES) {
          console.error(
            `Failed to process chunk after ${this.MAX_RETRIES} retries:`,
            error.message,
          );
          throw error;
        }

        console.warn(`Chunk failed, retrying (${retries}/${this.MAX_RETRIES}):`, error.message);

        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retries - 1)));
      }
    }
  }

  private async migrateDirectMessagesResilient(zip: AdmZip, directMessages: DirectMessage[]) {
    console.log('Migrating direct messages as conversations...');

    // First create conversations
    for (const dm of directMessages) {
      try {
        await this.client.query('BEGIN');
        await this.migrateDirectMessage(dm);
        await this.client.query('COMMIT');
        this.stats.conversationsCreated++;
      } catch (error) {
        await this.client.query('ROLLBACK');
        this.stats.errors.push(`DM ${dm.folderName}: ${error.message}`);
        console.warn(`Failed to migrate DM ${dm.folderName}:`, error.message);
      }
    }

    // Now migrate messages for DMs with chunking
    for (const dm of directMessages) {
      const conversationId = this.conversationMapping.get(dm.folderName);
      if (!conversationId) continue;

      try {
        await this.processDirectMessageMessages(zip, dm, conversationId);
        console.log(`Completed DM migration for: ${dm.folderName}`);
      } catch (error) {
        console.warn(`Failed to migrate DM messages for ${dm.folderName}:`, error.message);
      }
    }
  }

  private async processDirectMessageMessages(
    zip: AdmZip,
    dm: DirectMessage,
    conversationId: string,
  ) {
    // Load all messages for this DM
    const dmEntries = zip
      .getEntries()
      .filter((e) => e.entryName.startsWith(`${dm.folderName}/`) && e.entryName.endsWith('.json'));

    let allDmMessages: SlackMessage[] = [];

    for (const entry of dmEntries) {
      try {
        const dailyMessages = JSON.parse(entry.getData().toString());
        allDmMessages.push(...dailyMessages);
      } catch (e) {
        console.warn(`Failed to parse ${entry.entryName}`);
      }
    }

    const sortedMessages = allDmMessages
      .filter((m) => m.type === 'message' && m.user)
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    if (sortedMessages.length === 0) return;

    // Process DM messages in chunks
    for (let i = 0; i < sortedMessages.length; i += this.TRANSACTION_CHUNK_SIZE) {
      const messageChunk = sortedMessages.slice(i, i + this.TRANSACTION_CHUNK_SIZE);

      try {
        await this.client.query('BEGIN');

        // Batch check existing DM messages
        const existingTimestamps = new Set<string>();

        for (let j = 0; j < messageChunk.length; j += this.BATCH_CHECK_SIZE) {
          const timestampBatch = messageChunk.slice(j, j + this.BATCH_CHECK_SIZE).map((m) => m.ts);

          if (timestampBatch.length === 0) continue;

          const { rows: existing } = await this.client.query(
            `SELECT metadata->>'slack_ts' as slack_ts, id FROM messages
             WHERE workspace_id = $1 AND conversation_id = $2 AND metadata->>'slack_ts' = ANY($3)`,
            [this.workspaceId, conversationId, timestampBatch],
          );

          existing.forEach((row) => {
            existingTimestamps.add(row.slack_ts);
            this.messageMapping.set(row.slack_ts, row.id);
          });
        }

        // Process messages, skipping existing ones
        for (const message of messageChunk) {
          if (!existingTimestamps.has(message.ts)) {
            try {
              await this.migrateDirectMessageMessage(message, conversationId);
            } catch (msgError) {
              console.warn(`Failed to migrate DM message in ${dm.folderName}:`, msgError.message);
            }
          }
        }

        // Process reactions
        for (const message of messageChunk) {
          if (message.reactions) {
            try {
              await this.migrateReactions(message);
            } catch (reactionError) {
              console.warn(`Failed to migrate DM reactions:`, reactionError.message);
            }
          }
        }

        await this.client.query('COMMIT');
      } catch (error) {
        await this.client.query('ROLLBACK');
        console.warn(`Failed DM chunk for ${dm.folderName}:`, error.message);
      }

      // Delay between chunks
      if (i + this.TRANSACTION_CHUNK_SIZE < sortedMessages.length) {
        await new Promise((resolve) => setTimeout(resolve, this.MESSAGE_PROCESSING_DELAY));
      }
    }
  }

  private async migrateUserWithAuth(slackUser: SlackUser) {
    const email = slackUser.profile.email || `${slackUser.name}@imported.local`;
    const name = slackUser.profile.display_name || slackUser.real_name || slackUser.name;

    // Check if user already exists in our system
    const { rows: existingUsers } = await this.client.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );

    let userId: string;

    if (existingUsers.length > 0) {
      // User already exists in our system
      userId = existingUsers[0].id;
    } else {
      // Try to create user with Supabase Auth first
      try {
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
          email: email,
          user_metadata: { name: name },
          email_confirm: true, // Skip email confirmation for imported users
        });

        if (authError) {
          // Check if error is because user already exists in auth
          if (
            authError.message.includes('already registered') ||
            authError.message.includes('already exists') ||
            authError.message.includes('duplicate')
          ) {
            // User exists in auth but not in our users table
            // Create a placeholder user that can be claimed later
            userId = uuidv4();
            console.log(`Creating placeholder for existing auth user: ${email}`);
          } else {
            // Different error - could be invalid email, etc.
            throw new Error(`Could not create auth user: ${authError.message}`);
          }
        } else {
          // Successfully created auth user
          userId = authUser.user.id;
        }

        // Create the user record in our system
        await this.client.query(
          `INSERT INTO users (id, email, name, last_workspace_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             updated_at = NOW()
           RETURNING id`,
          [userId, email, name, this.workspaceId],
        );
      } catch (authError) {
        throw new Error(`Failed to create user: ${authError.message}`);
      }
    }

    // IMPORTANT: Always ensure workspace membership is created/updated
    await this.client.query(
      `INSERT INTO workspace_members (user_id, workspace_id, role, created_at, updated_at)
       VALUES ($1, $2, 'member', NOW(), NOW())
       ON CONFLICT (user_id, workspace_id) DO UPDATE SET
         updated_at = NOW(),
         is_deactivated = $3
       RETURNING id`,
      [userId, this.workspaceId, slackUser?.deleted || false],
    );

    this.userMapping.set(slackUser.id, userId);
  }

  private findDirectMessages(zip: AdmZip, users: SlackUser[]): DirectMessage[] {
    const entries = zip.getEntries();
    const directMessages: DirectMessage[] = [];

    // In Slack exports, DMs appear as folders that don't match channel names
    // They're usually named with user IDs or usernames separated by dashes
    const channelNames = new Set(['general', 'random']); // Add more known channel patterns

    // Find folders that contain messages but aren't channels
    const messageFolders = entries
      .filter((e) => e.entryName.includes('/') && e.entryName.endsWith('.json'))
      .map((e) => e.entryName.split('/')[0])
      .filter((folder, index, arr) => arr.indexOf(folder) === index); // unique

    for (const folder of messageFolders) {
      // Skip if it's a known channel
      if (channelNames.has(folder)) continue;

      // Check if folder name suggests it's a DM (contains dashes, user IDs, etc.)
      if (folder.includes('-') || folder.match(/^[A-Z0-9]{9,11}$/)) {
        // Try to extract participant user IDs/names
        const participants = folder.split('-').filter((p) => p.length > 0);

        if (participants.length >= 2) {
          directMessages.push({
            participants,
            folderName: folder,
          });
        }
      }
    }

    return directMessages;
  }

  private async migrateDirectMessage(dm: DirectMessage) {
    // Create conversation
    const { rows: conversationRows } = await this.client.query(
      `INSERT INTO conversations (workspace_id, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       RETURNING id`,
      [this.workspaceId],
    );

    const conversationId = conversationRows[0].id;
    this.conversationMapping.set(dm.folderName, conversationId);

    // Add participants to conversation
    for (const participantName of dm.participants) {
      // Try to find user by Slack username or ID
      let userId: string | undefined;

      // First try to find by exact Slack ID match
      userId = this.userMapping.get(participantName);

      // If not found, try to find by username/display name
      if (!userId) {
        for (const [slackId, mappedUserId] of this.userMapping.entries()) {
          // You might need to enhance this matching logic based on your Slack export format
          if (slackId.includes(participantName) || participantName.includes(slackId)) {
            userId = mappedUserId;
            break;
          }
        }
      }

      if (userId) {
        // Get workspace member ID
        const { rows: workspaceMembers } = await this.client.query(
          'SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
          [userId, this.workspaceId],
        );

        if (workspaceMembers.length > 0) {
          await this.client.query(
            `INSERT INTO conversation_members (conversation_id, workspace_member_id, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (conversation_id, workspace_member_id) DO NOTHING`,
            [conversationId, workspaceMembers[0].id],
          );
        }
      }
    }
  }

  private async migrateDirectMessageMessage(slackMessage: SlackMessage, conversationId: string) {
    const userId = this.userMapping.get(slackMessage.user || '');
    if (!userId) return;

    const { rows: workspaceMembers } = await this.client.query(
      'SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
      [userId, this.workspaceId],
    );

    if (workspaceMembers.length === 0) return;

    const parentMessageId =
      slackMessage.thread_ts && slackMessage.thread_ts !== slackMessage.ts
        ? this.messageMapping.get(slackMessage.thread_ts)
        : null;

    const timestamp = new Date(parseFloat(slackMessage.ts) * 1000).toISOString();

    // Store Slack metadata for deduplication and reference
    const metadata = {
      slack_ts: slackMessage.ts,
      slack_user: slackMessage.user,
      slack_thread_ts: slackMessage.thread_ts,
      imported_from: 'slack',
    };

    const { rows } = await this.client.query(
      `INSERT INTO messages (body, text, workspace_member_id, workspace_id, conversation_id, parent_message_id, thread_id, sender_type, needs_embedding, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user', true, $8, $9, $9)
       RETURNING id`,
      [
        slackMessage.text,
        slackMessage.text,
        workspaceMembers[0].id,
        this.workspaceId,
        conversationId,
        parentMessageId,
        parentMessageId,
        JSON.stringify(metadata),
        timestamp,
      ],
    );

    this.messageMapping.set(slackMessage.ts, rows[0].id);
    this.stats.messagesImported++;
  }

  private async migrateChannel(slackChannel: SlackChannel) {
    let channelId: string;

    if (slackChannel.name === 'general') {
      // Find existing general channel instead of creating new one
      const { rows: existingGeneral } = await this.client.query(
        'SELECT id FROM channels WHERE name = $1 AND workspace_id = $2',
        ['general', this.workspaceId],
      );

      if (existingGeneral.length > 0) {
        channelId = existingGeneral[0].id;
        console.log('Using existing general channel for Slack import');
      } else {
        // Fallback: create if somehow doesn't exist
        const { rows } = await this.client.query(
          `INSERT INTO channels (name, workspace_id, channel_type, description, is_default, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          ['general', this.workspaceId, 'public', slackChannel.purpose?.value || null, true],
        );
        channelId = rows[0].id;
      }
    } else {
      // Normal channel creation for non-general channels with conflict handling
      const { rows } = await this.client.query(
        `INSERT INTO channels (name, workspace_id, channel_type, description, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, NOW(), NOW())
         ON CONFLICT (name, workspace_id) DO UPDATE SET
           description = EXCLUDED.description,
           updated_at = NOW()
         RETURNING id`,
        [
          slackChannel.name,
          this.workspaceId,
          slackChannel.is_private ? 'private' : 'public',
          slackChannel.purpose?.value || null,
        ],
      );
      channelId = rows[0].id;
    }

    this.channelMapping.set(slackChannel.id, channelId);

    // Add members to channel
    if (slackChannel.members) {
      for (const slackUserId of slackChannel.members) {
        const userId = this.userMapping.get(slackUserId);
        if (userId) {
          try {
            const { rows: workspaceMembers } = await this.client.query(
              'SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
              [userId, this.workspaceId],
            );

            if (workspaceMembers.length > 0) {
              await this.client.query(
                `INSERT INTO channel_members (channel_id, workspace_member_id, role, created_at, updated_at)
                 VALUES ($1, $2, 'member', NOW(), NOW())
                 ON CONFLICT (channel_id, workspace_member_id) DO NOTHING`,
                [channelId, workspaceMembers[0].id],
              );
            }
          } catch (memberError) {
            console.warn(
              `Failed to add member to channel ${slackChannel.name}:`,
              memberError.message,
            );
          }
        }
      }
    }
  }

  private async migrateMessage(slackMessage: SlackMessage, channelId: string) {
    const userId = this.userMapping.get(slackMessage.user || '');
    if (!userId) return;

    const { rows: workspaceMembers } = await this.client.query(
      'SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
      [userId, this.workspaceId],
    );

    if (workspaceMembers.length === 0) return;

    const parentMessageId =
      slackMessage.thread_ts && slackMessage.thread_ts !== slackMessage.ts
        ? this.messageMapping.get(slackMessage.thread_ts)
        : null;

    const timestamp = new Date(parseFloat(slackMessage.ts) * 1000).toISOString();

    // Store Slack metadata for deduplication and reference
    const metadata = {
      slack_ts: slackMessage.ts,
      slack_user: slackMessage.user,
      slack_thread_ts: slackMessage.thread_ts,
      imported_from: 'slack',
    };

    const { rows } = await this.client.query(
      `INSERT INTO messages (body, text, workspace_member_id, workspace_id, channel_id, parent_message_id, thread_id, sender_type, needs_embedding, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user', true, $8, $9, $9)
       RETURNING id`,
      [
        slackMessage.text,
        slackMessage.text,
        workspaceMembers[0].id,
        this.workspaceId,
        channelId,
        parentMessageId,
        parentMessageId,
        JSON.stringify(metadata),
        timestamp,
      ],
    );

    this.messageMapping.set(slackMessage.ts, rows[0].id);
    this.stats.messagesImported++;
  }

  private async migrateReactions(slackMessage: SlackMessage) {
    const messageId = this.messageMapping.get(slackMessage.ts);
    if (!messageId || !slackMessage.reactions) return;

    for (const reaction of slackMessage.reactions) {
      for (const slackUserId of reaction.users) {
        const userId = this.userMapping.get(slackUserId);
        if (!userId) continue;

        const { rows: workspaceMembers } = await this.client.query(
          'SELECT id FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
          [userId, this.workspaceId],
        );

        if (workspaceMembers.length === 0) continue;

        try {
          await this.client.query(
            `INSERT INTO reactions (workspace_id, message_id, workspace_member_id, value, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (workspace_id, message_id, workspace_member_id, value) DO NOTHING`,
            [
              this.workspaceId,
              messageId,
              workspaceMembers[0].id,
              convertShortcodeToEmoji(reaction.name),
            ],
          );

          this.stats.reactionsAdded++;
        } catch (error) {
          // Ignore duplicate reactions
        }
      }
    }
  }
}

async function updateJobStatus(jobId: string, status: Partial<JobStatus>) {
  const client = await dbPool.connect();
  try {
    const updateData = {
      ...status,
      updated_at: new Date().toISOString(),
    };

    if (status.status === 'completed' || status.status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    // Use UPDATE instead of INSERT ... ON CONFLICT since job record should already exist
    const result = await client.query(
      `UPDATE migration_jobs SET
         status = $2,
         progress = $3,
         error = $4,
         completed_at = $5,
         updated_at = $6
       WHERE job_id = $1`,
      [
        jobId,
        updateData.status || 'pending',
        updateData.progress ? JSON.stringify(updateData.progress) : null,
        updateData.error || null,
        updateData.completed_at || null,
        updateData.updated_at,
      ],
    );

    if (result.rowCount === 0) {
      console.warn(`No migration job found with ID: ${jobId}`);
    }
  } catch (error) {
    console.error(`Failed to update job status for ${jobId}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function downloadFileFromStorageAsStream(
  storageKey: string,
): Promise<{ stream: Readable; size: number }> {
  try {
    console.log('Downloading file as stream from storage:', storageKey);

    const { data, error } = await supabase.storage.from('files').download(storageKey);

    if (error) {
      throw new Error(`Failed to download file: ${error.message}`);
    }

    if (!data) {
      throw new Error('No file data received from storage');
    }

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const stream = new Readable({
      read() {
        this.push(buffer);
        this.push(null);
      },
    });

    return {
      stream,
      size: buffer.length,
    };
  } catch (error) {
    console.error('Error downloading file from storage:', error);
    throw error;
  }
}

async function processMigrationJob(job: MigrationJob) {
  let client;

  try {
    console.log(`Starting migration job ${job.jobId} for workspace ${job.workspaceId}`);

    await updateJobStatus(job.jobId, { status: 'processing' });

    client = await dbPool.connect();

    const currentMember = await getWorkspaceMember(client, job.workspaceId, job.userId);
    if (!currentMember) {
      throw new Error('User is not a member of this workspace');
    }

    if (job.fileSize > 100 * 1024 * 1024) {
      throw new Error('File too large for migration. Please contact support for files over 100MB.');
    }

    const { stream, size } = await downloadFileFromStorageAsStream(job.storageKey);
    console.log(`Downloaded file stream from storage: ${size} bytes`);

    const migrator = new ResilientSlackMigrator(client, job.workspaceId, job.userId, job.jobId);
    const results = await migrator.migrateFromStream(stream, size);

    await updateJobStatus(job.jobId, {
      status: 'completed',
      progress: {
        usersCreated: results.usersCreated,
        channelsCreated: results.channelsCreated,
        conversationsCreated: results.conversationsCreated,
        messagesImported: results.messagesImported,
        reactionsAdded: results.reactionsAdded,
      },
    });

    try {
      await supabase.storage.from('files').remove([job.storageKey]);
      console.log('Cleaned up uploaded file from storage');
    } catch (cleanupError) {
      console.warn('Failed to clean up uploaded file:', cleanupError);
    }

    console.log(`Migration job ${job.jobId} completed successfully`);
  } catch (error) {
    console.error(`Migration job ${job.jobId} failed:`, error);

    let errorMessage = 'Migration failed';
    if (error.message.includes('Invalid Slack export')) {
      errorMessage =
        'Invalid Slack export file. Please ensure you uploaded a complete Slack export.';
    } else if (error.message.includes('Failed to download file')) {
      errorMessage = 'Could not access uploaded file. Please try uploading again.';
    } else {
      errorMessage = error.message;
    }

    // Always try to update job status, even if the original error was database-related
    try {
      await updateJobStatus(job.jobId, {
        status: 'failed',
        error: errorMessage,
      });
    } catch (statusUpdateError) {
      console.error(`Failed to update job status for failed job ${job.jobId}:`, statusUpdateError);
      // Don't throw here - we want the original error to be reported
    }

    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export const handler = async (event: SQSEvent) => {
  console.log('Processing migration jobs from SQS:', JSON.stringify(event, null, 2));

  const results = await Promise.allSettled(
    event.Records.map(async (record: SQSRecord) => {
      try {
        const job: MigrationJob = JSON.parse(record.body);
        console.log(`Processing job ${job.jobId} for workspace ${job.workspaceId}`);

        await processMigrationJob(job);

        console.log(`Successfully completed job ${job.jobId}`);
        return { jobId: job.jobId, success: true };
      } catch (error) {
        const jobId = JSON.parse(record.body).jobId;
        console.error(`Failed to process migration job ${jobId}:`, error);
        return {
          jobId,
          success: false,
          error: error.message,
        };
      }
    }),
  );

  const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.filter(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success),
  ).length;

  console.log(
    `Processed ${event.Records.length} migration jobs: ${successful} successful, ${failed} failed`,
  );

  if (failed > 0) {
    const failures = results
      .filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
      .map((r) => {
        if (r.status === 'fulfilled') {
          return r.value;
        } else {
          return { error: r.reason?.message || r.reason };
        }
      });

    console.error('Some migration jobs failed:', failures);
  }
};
