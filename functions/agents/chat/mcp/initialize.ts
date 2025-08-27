import { initializeLinearMCP } from './linear-server';

// Initialize MCP servers on Lambda cold start
export async function initializeMCPServers(): Promise<void> {
  try {
    console.log('🚀 Initializing MCP servers...');

    // Check for required environment variables
    if (!process.env.COMPOSIO_API_KEY) {
      console.warn('⚠️ COMPOSIO_API_KEY not found. Linear integration will not be available.');
      return;
    }

    // Initialize Linear MCP server
    const linearServer = initializeLinearMCP({
      // Optional configuration can be passed here
    });

    await linearServer.initialize();
    
    console.log('✅ MCP servers initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize MCP servers:', error);
    // Don't throw - allow Lambda to continue without MCP if initialization fails
  }
}

// Cleanup function for Lambda shutdown
export async function cleanupMCPServers(): Promise<void> {
  try {
    const { getLinearMCPInstance } = await import('./linear-server');
    const linearServer = getLinearMCPInstance();
    
    if (linearServer) {
      await linearServer.disconnect();
    }
    
    console.log('✅ MCP servers cleaned up successfully');
  } catch (error) {
    console.error('❌ Error during MCP cleanup:', error);
  }
}