import { get } from 'node-emoji';

export function convertShortcodeToEmoji(shortcode: string): string {
  const emoji = get(shortcode);
  return emoji || shortcode;
}
