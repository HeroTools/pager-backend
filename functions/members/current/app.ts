import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      console.log(userId);

      if (!userId) {
        return successResponse(null);
      }

      const workspaceId = event.pathParameters?.workspaceId;

      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      const member = await getMember(workspaceId, userId);

      console.log(member);

      if (!member) {
        return successResponse(null);
      }

      return successResponse(member);
    } catch (error) {
      console.error('Error getting current member:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
