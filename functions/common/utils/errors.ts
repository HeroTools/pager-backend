import { PostgrestError } from '@supabase/supabase-js';

export class ApplicationError extends Error {
    constructor(message: string | any, public data: Record<string, any> = {}) {
        super(message);
    }
}

export class UserError extends ApplicationError {}

export class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 401) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = statusCode;
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
