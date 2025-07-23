// src/tools/suggest-query-refinement.ts
import { tool } from '@openai/agents';
import { z } from 'zod';

export const suggestQueryRefinement = tool({
  name: 'suggest_query_refinement',
  description:
    'Provide user with options when dealing with large datasets, offering specific suggestions for refinement and processing approaches.',
  parameters: z.object({
    totalMessages: z.number().int().describe('Total number of messages found'),
    timeframeDays: z.number().describe('Number of days in the time range'),
    topChannels: z
      .array(
        z.object({
          name: z.string(),
          messageCount: z.number().int(),
        }),
      )
      .describe('Most active channels with message counts'),
    isLargeDataset: z.boolean().describe('Whether this is considered a large dataset'),
    currentQuery: z.string().describe('The original user query'),
    recommendedAction: z.enum(['proceed', 'refine', 'confirm']).describe('Recommended next action'),
  }),
  async execute(params) {
    const {
      totalMessages,
      timeframeDays,
      topChannels,
      isLargeDataset,
      currentQuery,
      recommendedAction,
    } = params;

    // Generate time context
    let timeText = '';
    if (timeframeDays < 1) {
      timeText = 'today';
    } else if (timeframeDays === 1) {
      timeText = 'yesterday';
    } else if (timeframeDays <= 7) {
      timeText = `the last ${Math.round(timeframeDays)} days`;
    } else {
      timeText = `the last ${Math.round(timeframeDays / 7)} weeks`;
    }

    // Create response based on dataset size
    if (!isLargeDataset) {
      return {
        shouldProceed: true,
        message: `Found ${totalMessages} messages from ${timeText}. This is a manageable amount - I'll process them all.`,
        processingApproach: 'complete',
        channels: topChannels,
      };
    }

    // Large dataset - provide options
    const channelSuggestions = topChannels
      .slice(0, 3)
      .map((channel) => `**${channel.name}** (${channel.messageCount} messages)`)
      .join('\n');

    const refinementOptions = [];

    if (topChannels.length > 1) {
      refinementOptions.push(`🔍 **Focus on specific channels:**\n${channelSuggestions}`);
    }

    if (timeframeDays > 1) {
      refinementOptions.push(
        `⏰ **Narrow the time range:**\n- Focus on the most recent day\n- Look at specific time periods (morning, afternoon)`,
      );
    }

    refinementOptions.push(
      `📊 **Choose processing approach:**\n- High-level summary first\n- Process in smaller chunks\n- Focus on key decisions and announcements`,
    );

    const message = `I found **${totalMessages} messages** from ${timeText} across ${topChannels.length} channels. That's quite a lot of data!

**Most active channels:**
${channelSuggestions}

**Your options:**

${refinementOptions.join('\n\n')}

**My recommendation:** ${recommendedAction === 'proceed' ? 'Start with a high-level summary of key themes and decisions.' : 'Consider filtering to specific channels or time periods first.'}

How would you like to proceed?`;

    return {
      shouldProceed: false,
      message,
      processingApproach: 'requires_confirmation',
      totalMessages,
      channels: topChannels,
      refinementSuggestions: [
        { type: 'channel', description: 'Filter to specific channels' },
        { type: 'time', description: 'Narrow the time range' },
        { type: 'summary', description: 'Start with high-level summary' },
        { type: 'chunked', description: 'Process in smaller batches' },
      ],
    };
  },
});
