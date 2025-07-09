export const parseChannelName = (name: string): string => {
  return name.replace(/\s+/g, '-').toLowerCase();
};
