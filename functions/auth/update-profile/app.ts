import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);

    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const { name, image } = JSON.parse(event.body || '{}');

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (image !== undefined) updateData.image = image;

    if (Object.keys(updateData).length === 0) {
      return errorResponse('No fields to update', 400);
    }

    updateData.updated_at = new Date().toISOString();

    // Update user profile
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return successResponse({ profile: data });
  } catch (error) {
    console.error('Error updating profile:', error);
    return errorResponse('Internal server error', 500);
  }
};
