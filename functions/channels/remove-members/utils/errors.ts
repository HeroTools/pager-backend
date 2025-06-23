export class ValidationError extends Error {
    constructor(message: string, public details?: any) {
        super(message);
        this.name = 'ValidationError';
    }
}

export class AuthenticationError extends Error {
    constructor(message: string = 'Authentication failed') {
        super(message);
        this.name = 'AuthenticationError';
    }
}

export class AuthorizationError extends Error {
    constructor(message: string = 'Access denied') {
        super(message);
        this.name = 'AuthorizationError';
    }
} 