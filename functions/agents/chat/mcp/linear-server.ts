import { Composio } from '@composio/core';

interface LinearConfig {
  apiKey?: string;
  workspaceId?: string;
  teamId?: string;
}

export class LinearMCPServer {
  private composio: Composio;
  private config: LinearConfig;

  constructor(config: LinearConfig = {}) {
    this.config = config;
    
    // Initialize Composio with API key from environment
    this.composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
  }

  async initialize(): Promise<void> {
    try {
      console.log('✅ Linear MCP Server initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Linear MCP Server:', error);
      throw error;
    }
  }

  async getAvailableActions(): Promise<any[]> {
    try {
      // Get the list of available Linear actions from Composio
      const actions = await this.composio.actions.list({
        apps: ['linear']
      });
      return actions.items || [];
    } catch (error) {
      console.error('Failed to get available Linear actions:', error);
      throw error;
    }
  }

  async authenticateUser(userId: string): Promise<{ authUrl?: string; isAuthenticated: boolean }> {
    try {
      // Check if user is already authenticated with Linear via Composio
      const entity = await this.composio.getEntity(userId);
      const connection = await entity.getConnection({
        app: 'linear'
      });
      
      if (connection && connection.connectionStatus === 'ACTIVE') {
        return { isAuthenticated: true };
      }

      // Generate OAuth URL for Linear authentication
      const authResponse = await entity.initiateConnection({
        app: 'linear',
        config: {
          redirectUrl: `${process.env.FRONTEND_URL}/integrations/linear/callback`,
        }
      });

      return { authUrl: authResponse.redirectUrl, isAuthenticated: false };
    } catch (error) {
      console.error('Linear authentication error:', error);
      
      // If entity doesn't exist, create it and try again
      if ((error as Error).message?.includes('Entity not found')) {
        await this.composio.getEntity(userId);
        return await this.authenticateUser(userId);
      }
      
      throw error;
    }
  }

  async handleAuthCallback(userId: string, authCode: string): Promise<boolean> {
    try {
      const entity = await this.composio.getEntity(userId);
      const result = await entity.saveUserAccessData({
        app: 'linear',
        authConfig: {
          code: authCode,
          redirectUrl: `${process.env.FRONTEND_URL}/integrations/linear/callback`,
        }
      });

      return result.connectionStatus === 'ACTIVE';
    } catch (error) {
      console.error('Linear auth callback error:', error);
      throw error;
    }
  }

  async executeLinearAction(
    userId: string, 
    actionName: string, 
    params: Record<string, any>
  ): Promise<any> {
    try {
      const entity = await this.composio.getEntity(userId);
      
      // Execute Linear action through Composio
      const result = await entity.execute({
        action: actionName,
        params: params,
        entityId: userId
      });
      
      return result;
    } catch (error) {
      console.error(`Linear action ${actionName} failed:`, error);
      throw error;
    }
  }

  // Get current user info
  async getCurrentUser(userId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_CURRENT_USER', {});
  }

  // Get Linear issues with filters
  async getLinearIssues(userId: string, filters: Record<string, any> = {}): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_ISSUES', filters);
  }

  // Update existing Linear issue
  async updateLinearIssue(userId: string, issueId: string, updates: Record<string, any>): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_UPDATE_ISSUE', { issueId, ...updates });
  }

  // Get all projects
  async getLinearProjects(userId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_PROJECTS', {});
  }

  // Get all cycles
  async getLinearCycles(userId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_CYCLES', {});
  }

  // Get team labels
  async getLinearTeamLabels(userId: string, teamId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_TEAM_LABELS', { teamId });
  }

  // Get team workflow states
  async getLinearTeamStates(userId: string, teamId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_GET_TEAM_WORKFLOW_STATES', { teamId });
  }

  // Remove label from issue
  async removeLabelFromIssue(userId: string, issueId: string, labelId: string): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_REMOVE_LABEL_FROM_ISSUE', { issueId, labelId });
  }

  // Execute custom GraphQL query/mutation
  async executeLinearGraphQL(userId: string, query: string, variables?: Record<string, any>): Promise<any> {
    return await this.executeLinearAction(userId, 'LINEAR_EXECUTE_GRAPHQL', { query, variables });
  }

  async disconnect(): Promise<void> {
    try {
      console.log('Linear MCP Server disconnected');
    } catch (error) {
      console.error('Error disconnecting Linear MCP Server:', error);
    }
  }
}

// Singleton instance for the application
let linearMCPInstance: LinearMCPServer | null = null;

export function initializeLinearMCP(config: LinearConfig = {}): LinearMCPServer {
  if (!linearMCPInstance) {
    linearMCPInstance = new LinearMCPServer(config);
  }
  return linearMCPInstance;
}

export function getLinearMCPInstance(): LinearMCPServer | null {
  return linearMCPInstance;
}