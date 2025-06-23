import { APIGatewayProxyResult } from 'aws-lambda';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export const successResponse = (data: any, statusCode: number = 200): APIGatewayProxyResult => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
        body: JSON.stringify({
            success: true,
            data,
        }),
    };
};

export const errorResponse = (
    message: string,
    statusCode: number = 500,
    details?: any,
): APIGatewayProxyResult => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
        body: JSON.stringify({
            success: false,
            error: {
                message,
                ...(details && { details }),
            },
        }),
    };
};

export const corsResponse = (): APIGatewayProxyResult => {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
    };
}; 