import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const { token, type = 'signup' } = JSON.parse(event.body || '{}');

      if (!token) {
        return errorResponse('Token is required', 400);
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: type as any,
      });

      if (error) {
        return errorResponse(error.message, 400);
      }

      return successResponse({
        user: data.user,
        session: data.session,
        message: 'Email verified successfully',
      });
    } catch (error) {
      console.error('Error verifying email:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
