import { tool } from '@openai/agents';
import { z } from 'zod';

export const parseTimeExpression = tool({
  name: 'parse_time_expression',
  description:
    'Parse natural time expressions like "yesterday", "last week", and return start/end ISO timestamps. Use this when users mention time-relative terms.',
  parameters: z.object({
    expression: z
      .string()
      .min(1)
      .describe('The time expression to parse (e.g., "yesterday", "last week")'),
  }),
  execute({ expression }) {
    const now = new Date();
    const lower = expression.toLowerCase();
    let start: Date;
    const end = new Date(now);

    if (/yesterday/.test(lower)) {
      start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (/today/.test(lower)) {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      // end stays as current time
    } else if (/last week/.test(lower)) {
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1); // End of yesterday
      end.setHours(23, 59, 59, 999);
    } else if (/this week/.test(lower)) {
      // Week starts on Sunday
      const dayOfWeek = now.getDay();
      start = new Date(now);
      start.setDate(start.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      // end stays as current time
    } else if (/last month/.test(lower)) {
      start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      start.setDate(1); // First day of last month
      start.setHours(0, 0, 0, 0);

      // Last day of last month
      end.setDate(0); // This sets to last day of previous month
      end.setHours(23, 59, 59, 999);
    } else if (/this month/.test(lower)) {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      // end stays as current time
    } else {
      const match = /last (\d+) days?/.exec(lower);
      if (match) {
        const days = parseInt(match[1], 10);
        start = new Date(now);
        start.setDate(start.getDate() - days);
        start.setHours(0, 0, 0, 0);
        // end stays as current time
      } else {
        // Default to last 24 hours
        start = new Date(now);
        start.setDate(start.getDate() - 1);
        start.setHours(0, 0, 0, 0);
      }
    }

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      parsed_expression: expression,
      success: true,
    };
  },
});
