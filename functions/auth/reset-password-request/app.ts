import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return errorResponse('Email is required', 400);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
    });

    if (error) {
      return errorResponse(error.message, 400);
    }

    return successResponse({
      message: 'Password reset email sent successfully',
    });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return errorResponse('Internal server error', 500);
  }
};
