import { PostgrestError } from '@supabase/supabase-js';

export class ApplicationError extends Error {
  public statusCode: number;
  public data?: Record<string, any>;

  constructor(message: string, statusCode = 400, data: Record<string, any> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthError extends ApplicationError {
  constructor(message = 'Unauthorized', statusCode = 401) {
    super(message, statusCode);
  }
}

export const parseRpcError = (error: PostgrestError): { statusCode: number; message: string } => {
  if (error.message.includes('INVALID_INVITE_TOKEN')) {
    return { statusCode: 400, message: 'Invalid or expired invite token.' };
  }
  if (error.message.includes('INVITE_LIMIT_REACHED')) {
    return { statusCode: 400, message: 'Invite token has reached its usage limit.' };
  }
  if (error.message.includes('ALREADY_MEMBER')) {
    return { statusCode: 409, message: 'User is already a member of this workspace.' };
  }
  // Default fallback
  return { statusCode: 500, message: 'Failed to join workspace due to a database error.' };
};

export class ChannelError extends ApplicationError {
  private constructor(message: string, statusCode: number, data: Record<string, any> = {}) {
    super(message, statusCode, data);
  }

  static notFound() {
    return new ChannelError('Channel not found', 404);
  }

  static notMember() {
    return new ChannelError('User is not a member of this channel', 403);
  }

  static onlyAdmins() {
    return new ChannelError('Only channel admins can invite members', 403);
  }

  static invalidMembers(invalid: string[]) {
    return new ChannelError('Some members cannot be invited', 400, { invalidMemberIds: invalid });
  }

  static alreadyInChannel(count: number) {
    return new ChannelError('One or more members are already in the channel', 409, {
      skipped: count,
    });
  }

  static invalidReference() {
    return new ChannelError('Invalid channel or member reference', 400);
  }

  static invalidData() {
    return new ChannelError('Invalid data provided', 400);
  }
}
