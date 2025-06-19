export class ApplicationError extends Error {
    constructor(message: string | any, public data: Record<string, any> = {}) {
        super(message);
    }
}

export class UserError extends ApplicationError { }

export class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 401) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = statusCode;
    }
}
