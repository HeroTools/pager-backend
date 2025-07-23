import { tool } from '@openai/agents';
import { z } from 'zod';

export const createStructuredSummary = tool({
  name: 'create_summary',
  description: 'Generate a summary in bullet, paragraph, or timeline form',
  parameters: z.object({
    content: z.string().describe('The content to summarize'),
    // Fix: Use default instead of optional for enums
    format: z
      .enum(['bullet_points', 'paragraph', 'timeline'])
      .default('paragraph')
      .describe('Output format for the summary'),
  }),
  execute({ content, format }) {
    // Enhanced summary logic
    if (format === 'bullet_points') {
      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      if (lines.length <= 1) {
        // Single line or empty content
        return {
          format,
          summary: `• ${content.trim()}`,
          success: true,
        };
      }

      const bulletPoints = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => `• ${line.replace(/^[•\-\*]\s*/, '')}`) // Remove existing bullets
        .join('\n');

      return {
        format,
        summary: bulletPoints,
        success: true,
      };
    }

    if (format === 'timeline') {
      return {
        format,
        summary: `**Timeline Summary:**\n${content}`,
        success: true,
      };
    }

    // Default paragraph format
    return {
      format: 'paragraph',
      summary: content.trim(),
      success: true,
    };
  },
});
