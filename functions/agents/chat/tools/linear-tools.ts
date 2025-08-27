import { tool } from '@openai/agents';
import { z } from 'zod';
import { getLinearMCPInstance } from '../mcp/linear-server';
import type { RunContext } from '@openai/agents';

// Authentication tool
export const authenticateLinear = tool({
  name: 'authenticate_linear',
  description: 'Authenticate user with Linear to enable Linear operations. Returns authentication URL if not already authenticated.',
  parameters: z.object({}),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const authResult = await linearServer.authenticateUser(userId);

      if (authResult.isAuthenticated) {
        return {
          success: true,
          message: 'Already authenticated with Linear',
          isAuthenticated: true,
        };
      }

      return {
        success: true,
        message: 'Authentication required. Please visit the provided URL to authenticate with Linear.',
        isAuthenticated: false,
        authUrl: authResult.authUrl,
      };
    } catch (error) {
      console.error('Linear authentication error:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to authenticate with Linear',
      };
    }
  },
});

// Get current user info
export const getCurrentLinearUser = tool({
  name: 'get_current_linear_user',
  description: 'Get information about the currently authenticated Linear user. Use this to identify "me" in other operations.',
  parameters: z.object({}),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const currentUser = await linearServer.getCurrentUser(userId);

      return {
        success: true,
        user: currentUser.data || currentUser,
        message: `Retrieved current Linear user information`,
      };
    } catch (error) {
      console.error('Failed to get current Linear user:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to get current Linear user. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Get Linear issues
export const getLinearIssues = tool({
  name: 'get_linear_issues',
  description: 'Retrieve Linear issues with optional filters. Can filter by assignee, project, etc.',
  parameters: z.object({
    assigneeId: z.string().optional().nullable().describe('Filter issues by assignee ID (use getCurrentLinearUser to get your ID)'),
    projectId: z.string().optional().nullable().describe('Filter issues by project ID'),
    limit: z.number().default(20).describe('Maximum number of issues to return'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const issues = await linearServer.getLinearIssues(userId, params);

      return {
        success: true,
        issues: issues.data || issues,
        message: `Retrieved ${issues.data?.length || 0} Linear issues`,
      };
    } catch (error) {
      console.error('Failed to get Linear issues:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve Linear issues. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Create Linear issue using GraphQL
export const createLinearIssue = tool({
  name: 'create_linear_issue',
  description: 'Create a new Linear issue with title, description, and optional properties using GraphQL.',
  parameters: z.object({
    title: z.string().describe('Issue title'),
    description: z.string().optional().nullable().describe('Issue description'),
    teamId: z.string().describe('Team ID to assign the issue to (required)'),
    assigneeId: z.string().optional().nullable().describe('User ID to assign the issue to'),
    priority: z.number().min(0).max(4).optional().nullable().describe('Priority level (0=No priority, 1=Low, 2=Medium, 3=High, 4=Urgent)'),
    labelIds: z.array(z.string()).optional().nullable().describe('Array of label IDs to apply to the issue'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      
      // Build the GraphQL mutation for creating an issue
      const mutation = `
        mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              description
              url
              priority
              state {
                id
                name
              }
              assignee {
                id
                name
              }
              team {
                id
                name
              }
            }
          }
        }
      `;

      const variables = {
        input: {
          title: params.title,
          ...(params.description && { description: params.description }),
          teamId: params.teamId,
          ...(params.assigneeId && { assigneeId: params.assigneeId }),
          ...(params.priority !== undefined && { priority: params.priority }),
          ...(params.labelIds && { labelIds: params.labelIds }),
        }
      };

      const result = await linearServer.executeLinearGraphQL(userId, mutation, variables);

      return {
        success: true,
        issue: result.data?.issueCreate?.issue || result,
        message: `Successfully created Linear issue: ${params.title}`,
      };
    } catch (error) {
      console.error('Failed to create Linear issue:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create Linear issue. Please make sure you are authenticated with Linear and have access to the specified team.',
      };
    }
  },
});

// Update Linear issue
export const updateLinearIssue = tool({
  name: 'update_linear_issue',
  description: 'Update an existing Linear issue by ID.',
  parameters: z.object({
    issueId: z.string().describe('Linear issue ID to update'),
    title: z.string().optional().nullable().describe('New issue title'),
    description: z.string().optional().nullable().describe('New issue description'),
    stateId: z.string().optional().nullable().describe('New state ID for the issue'),
    assigneeId: z.string().optional().nullable().describe('New assignee ID'),
    priority: z.number().min(0).max(4).optional().nullable().describe('New priority level'),
    labelIds: z.array(z.string()).optional().nullable().describe('New array of label IDs'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const { issueId, ...updates } = params;
      const result = await linearServer.updateLinearIssue(userId, issueId, updates);

      return {
        success: true,
        issue: result.data || result,
        message: `Successfully updated Linear issue: ${issueId}`,
      };
    } catch (error) {
      console.error('Failed to update Linear issue:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to update Linear issue. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Get Linear projects
export const getLinearProjects = tool({
  name: 'get_linear_projects',
  description: 'Retrieve all Linear projects in the workspace.',
  parameters: z.object({}),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const projects = await linearServer.getLinearProjects(userId);

      return {
        success: true,
        projects: projects.data || projects,
        message: `Retrieved ${projects.data?.length || 0} Linear projects`,
      };
    } catch (error) {
      console.error('Failed to get Linear projects:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve Linear projects. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Get Linear cycles
export const getLinearCycles = tool({
  name: 'get_linear_cycles',
  description: 'Retrieve all Linear cycles (sprints/iterations) in the workspace.',
  parameters: z.object({}),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const cycles = await linearServer.getLinearCycles(userId);

      return {
        success: true,
        cycles: cycles.data || cycles,
        message: `Retrieved ${cycles.data?.length || 0} Linear cycles`,
      };
    } catch (error) {
      console.error('Failed to get Linear cycles:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve Linear cycles. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Get team labels
export const getLinearTeamLabels = tool({
  name: 'get_linear_team_labels',
  description: 'Retrieve all labels for a specific Linear team.',
  parameters: z.object({
    teamId: z.string().describe('Team ID to get labels for'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const labels = await linearServer.getLinearTeamLabels(userId, params.teamId);

      return {
        success: true,
        labels: labels.data || labels,
        message: `Retrieved ${labels.data?.length || 0} labels for team`,
      };
    } catch (error) {
      console.error('Failed to get Linear team labels:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve Linear team labels. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Create Linear comment
export const createLinearComment = tool({
  name: 'create_linear_comment',
  description: 'Add a comment to a Linear issue.',
  parameters: z.object({
    issueId: z.string().describe('Linear issue ID to comment on'),
    comment: z.string().describe('Comment text to add'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      const result = await linearServer.createLinearComment(userId, params.issueId, params.comment);

      return {
        success: true,
        comment: result.data || result,
        message: `Successfully added comment to Linear issue: ${params.issueId}`,
      };
    } catch (error) {
      console.error('Failed to create Linear comment:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to add comment to Linear issue. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Search Linear issues by text
export const searchLinearIssues = tool({
  name: 'search_linear_issues',
  description: 'Search Linear issues by text query across titles and descriptions.',
  parameters: z.object({
    query: z.string().describe('Search query text'),
    teamId: z.string().optional().nullable().describe('Filter results by team ID'),
    limit: z.number().default(10).describe('Maximum number of results to return'),
  }),
  execute: async (params, context: RunContext) => {
    try {
      const linearServer = getLinearMCPInstance();
      if (!linearServer) {
        throw new Error('Linear MCP server not initialized');
      }

      const userId = context.userId || 'default-user';
      
      // Search by getting all issues and filtering (Linear API may have better search endpoints)
      const allIssues = await linearServer.getLinearIssues(userId, {
        teamId: params.teamId,
        limit: params.limit * 2, // Get more to filter
      });

      const issues = allIssues.data || allIssues;
      
      // Filter by search query
      const filteredIssues = issues.filter((issue: any) => {
        const title = issue.title?.toLowerCase() || '';
        const description = issue.description?.toLowerCase() || '';
        const searchQuery = params.query.toLowerCase();
        
        return title.includes(searchQuery) || description.includes(searchQuery);
      }).slice(0, params.limit);

      return {
        success: true,
        issues: filteredIssues,
        message: `Found ${filteredIssues.length} Linear issues matching "${params.query}"`,
        query: params.query,
      };
    } catch (error) {
      console.error('Failed to search Linear issues:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to search Linear issues. Please make sure you are authenticated with Linear.',
      };
    }
  },
});

// Export all Linear tools as an array
export const linearTools = [
  authenticateLinear,
  getCurrentLinearUser,
  getLinearIssues,
  createLinearIssue,
  updateLinearIssue,
  getLinearProjects,
  getLinearCycles,
  getLinearTeamLabels,
  createLinearComment,
  searchLinearIssues,
];