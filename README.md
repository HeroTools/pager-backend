# Pager Backend

A serverless backend built with AWS SAM and TypeScript, providing APIs for workspace management, authentication, messaging, and more.

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [AWS CLI](https://aws.amazon.com/cli/) configured with your credentials
- [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- [Docker](https://www.docker.com/) (for local development)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/HeroTools/pager-backend.git
   cd pager-backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up local configuration**

   ```bash
   npm run setup:local
   ```

   This creates `config/parameters.json` from the example template.

4. **Configure your environment**
   Edit `config/parameters.json` with your actual values:

   ```json
   {
     "dev": [
       {
         "name": "openai-api-key",
         "value": "sk-your-openai-key-here",
         "type": "SecureString"
       },
       {
         "name": "supabase-url",
         "value": "https://your-project.supabase.co",
         "type": "String"
       }
     ]
   }
   ```

5. **Start local development**
   ```bash
   npm run local:dev
   ```

Your API will be available at `http://localhost:8081` 🎉

## 📁 Project Structure

This project follows a domain-driven architecture where functionality is organized by business domains. Each domain contains its own set of Lambda functions, promoting modularity and maintainability.

### Core Directories

- **`functions/`** - Contains all Lambda functions organized by domain:
  - `agents/` - Agent management functionality
  - `attachments/` - File attachment handling
  - `auth/` - Authentication and authorization
  - `channels/` - Channel management
  - `conversations/` - Conversation handling
  - `embeddings/` - Vector embeddings processing
  - `members/` - Member management
  - `messages/` - Message processing
  - `notifications/` - Notification system
  - `reactions/` - Message reactions
  - `search/` - Search functionality
  - `workspaces/` - Workspace management
  - `common/` - Shared utilities and types used across domains
  - `migration/` - Slack workspace migrations

- **`supabase/`** - Supabase configuration, database migrations, and schema definitions
- **`scripts/`** - Utility scripts for generating environment variables and upserting secrets to AWS Secrets Manager
- **`config/`** - Environment-specific configuration files
- **`.aws-sam/`** - SAM CLI build artifacts and cache (auto-generated)

### Key Configuration Files

- **`template.yaml`** - SAM template defining all AWS resources and Lambda functions
- **`samconfig.toml`** - SAM CLI configuration with build caching and deployment settings
- **`tsconfig.json`** - TypeScript configuration
- **`package.json`** - Node.js dependencies and scripts
- **`env.json`** - Environment variables for local development

### Build and Deployment

The project uses **esbuild** for fast bundling and tree-shaking. Only imported packages are included in the final Lambda bundles, keeping deployment sizes minimal.

**Key behaviors:**

- Single `template.yaml` manages all domains and functions
- Build process compiles all functions but uses aggressive caching
- Deployments are incremental - only changed functions are updated
- Shared code changes in `common/` trigger rebuilds for dependent functions
- Template configuration changes affect all functions

## 🛠️ Development

### Local Development

```bash
# Start local API server
npm run local:dev

# Build the project
npm run build

# Lint and format code
npm run lint
npm run format
```

### Available Scripts

| Script                      | Description                         |
| --------------------------- | ----------------------------------- |
| `npm run local:dev`         | Start local development server      |
| `npm run local:prod`        | Start local server with prod config |
| `npm run deploy:dev`        | Deploy to dev environment           |
| `npm run deploy:dev:setup`  | Deploy to dev with secrets setup    |
| `npm run deploy:prod`       | Deploy to production                |
| `npm run deploy:prod:setup` | Deploy to prod with secrets setup   |
| `npm run setup:local`       | Set up local configuration          |
| `npm run setup:aws`         | Configure AWS Secrets Manager       |
| `npm run generate:env`      | Generate environment variables      |
| `npm run build`             | Build all Lambda functions          |
| `npm run lint`              | Lint and fix TypeScript code        |
| `npm run format`            | Format code with Prettier           |

### Environment Variables

The project uses AWS Secrets Manager for secure secret management:

- **Local development**: Uses generated `env.json` from your `config/parameters.json`
- **AWS deployment**: Reads from AWS Secrets Manager (`/unowned/dev/` or `/unowned/prod/`)

## 🔧 Configuration

### Required Configuration Values

| Parameter                   | Description                    | Example                            |
| --------------------------- | ------------------------------ | ---------------------------------- |
| `openai-api-key`            | OpenAI API key for AI features | `sk-...`                           |
| `google-client-id`          | Google OAuth client ID         | `123...apps.googleusercontent.com` |
| `google-client-secret`      | Google OAuth client secret     | `GOCSPX-...`                       |
| `supabase-url`              | Supabase project URL           | `https://xxx.supabase.co`          |
| `supabase-anon-key`         | Supabase anonymous key         | `eyJhbGcixxxxx...`                 |
| `supabase-service-role-key` | Supabase service role key      | `eyJhbGcixxxxx...`                 |
| `pg-password`               | PostgreSQL password            | `your-secure-password`             |

### URL Configuration

These are used for CORS and redirecting to the frontend. Please update them in the template.yaml file.

| Parameter         | Description              | Default                 |
| ----------------- | ------------------------ | ----------------------- |
| `frontend-url`    | Frontend application URL | `http://localhost:3000` |
| `allowed-origins` | CORS allowed origins     | `http://localhost:3000` |

## 🚀 Deployment

### First-time Deployment (with secrets setup)

For your first deployment to each environment, use the setup scripts to configure AWS Secrets Manager:

```bash
# Development environment (first time)
npm run deploy:dev:setup

# Production environment (first time)
npm run deploy:prod:setup
```

### Regular Deployment

After initial setup, use the regular deployment commands:

```bash
# Development environment
npm run deploy:dev

# Production environment
npm run deploy:prod
```

The deployment will:

1. Generate environment variables from configuration
2. Set up AWS Secrets Manager with your configuration (setup only)
3. Build all Lambda functions
4. Deploy infrastructure using CloudFormation
5. Configure API Gateway endpoints

## 🏗️ Architecture

### Services

- **Authentication**: JWT-based auth with Google OAuth integration
- **Workspaces**: Multi-tenant workspace management
- **Messages**: Real-time messaging system
- **Attachments**: File upload and management
- **Notifications**: Push notification delivery
- **Search**: Full-text search across content
- **Embeddings**: Vector search using OpenAI embeddings

### Infrastructure

- **Runtime**: Node.js 20.x
- **Database**: PostgreSQL (via Supabase)
- **Storage**: AWS S3 (via Supabase Storage)
- **Authentication**: Supabase Auth
- **Secrets**: AWS Secrets Manager
- **Deployment**: AWS SAM/CloudFormation
- **Monitoring**: AWS CloudWatch

## 🔐 Security

- All secrets stored in AWS Secrets Manager
- Environment variables never contain plain-text secrets
- JWT token validation on protected endpoints
- CORS configured for frontend domains
- Input validation using Zod schemas

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Set up your local environment (`npm run setup:local`)
4. Make your changes and test locally (`npm run local:dev`)
5. Run linting and formatting (`npm run lint && npm run format`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Guidelines

- Use TypeScript for all new code
- Follow the existing folder structure by domain
- Add tests for new functionality
- Use meaningful commit messages
- Update documentation as needed
- Run `npm run lint` and `npm run format` before committing

### Getting Help

1. Check the [Issues](https://github.com/HeroTools/pager-backend/issues) page
2. Search existing discussions
3. Create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Your environment details
   - Relevant logs or error messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Team

- **Zach Bresler** - _CTO_ - [@zachbresler](https://github.com/zachbresler)
- **Gabriel Stein** - _CEO_ - [@gabrielstein](https://github.com/gabrielste1n)

## 🙏 Acknowledgments

- Database provided by [Supabase](https://supabase.com/)
- AI capabilities powered by [OpenAI](https://openai.com/)
