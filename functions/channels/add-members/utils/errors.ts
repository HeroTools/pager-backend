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
        return new ChannelError('One or more members are already in the channel', 409, { skipped: count });
    }

    static invalidReference() {
        return new ChannelError('Invalid channel or member reference', 400);
    }

    static invalidData() {
        return new ChannelError('Invalid data provided', 400);
    }
}
