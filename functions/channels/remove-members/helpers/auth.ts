import { supabase } from '../utils/supabase-client';

const getUserIdFromToken = async (authHeader?: string): Promise<string | null> => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);

    try {
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser(token);
        if (error || !user) {
            return null;
        }
        return user.id;
    } catch (error) {
        return null;
    }
};

export { getUserIdFromToken }; 