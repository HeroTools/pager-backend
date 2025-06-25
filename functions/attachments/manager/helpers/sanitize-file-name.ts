const sanitizeFilename = (filename: string): string => {
    return filename
        .replace(/[^a-zA-Z0-9.\-_]/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/\.{2,}/g, '.') // Replace multiple dots with a single dot
        .replace(/^\./, '') // Remove leading dot
        .trim();
};

export default sanitizeFilename;
