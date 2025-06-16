import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return successResponse(null);
        }

        const workspaceId = event.queryStringParameters?.workspaceId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        const member = await getMember(workspaceId, userId);

        if (!member) {
            return successResponse(null);
        }

        return successResponse(member);
    } catch (error) {
        console.error('Error getting current member:', error);
        return errorResponse('Internal server error', 500);
    }
};
