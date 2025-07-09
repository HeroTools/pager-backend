# Unowned Backend

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
   git clone https://github.com/DEX-TEAM-AI/unowned-backend.git
   cd unowned-backend
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

```
unowned-backend/
├── functions/                    # Lambda functions organized by domain
│   ├── auth/                    # Authentication functions
│   │   ├── sign-in/
│   │   ├── sign-up/
│   │   └── google-auth/
│   ├── workspaces/              # Workspace management
│   ├── messages/                # Messaging system
│   ├── attachments/             # File attachments
│   └── notifications/           # Push notifications
├── config/                      # Configuration files
│   ├── parameters.json          # Your actual config (gitignored)
│   └── parameters.example.json  # Template for contributors
├── scripts/                     # Utility scripts
│   ├── setup-parameters.ts      # AWS Parameter Store setup
│   └── generate-env.ts          # Local environment generation
├── template.yaml                # SAM template (60+ functions)
└── samconfig.toml              # SAM deployment configuration
```

## 🛠️ Development

### Local Development

```bash
# Start local API server
npm run local:dev

# Build the project
npm run build

# Run tests
npm run test

# Lint code
npm run lint
```

### Available Scripts

| Script                | Description                         |
| --------------------- | ----------------------------------- |
| `npm run local:dev`   | Start local development server      |
| `npm run local:prod`  | Start local server with prod config |
| `npm run deploy:dev`  | Deploy to dev environment           |
| `npm run deploy:prod` | Deploy to production                |
| `npm run setup:local` | Set up local configuration          |
| `npm run setup:aws`   | Configure AWS Parameter Store       |

### Environment Variables

The project uses AWS Parameter Store for secure secret management:

- **Local development**: Uses generated `env.json` from your `config/parameters.json`
- **AWS deployment**: Reads from Parameter Store (`/unowned/dev/` or `/unowned/prod/`)

## 🔧 Configuration

### Required Configuration Values

| Parameter                   | Description                    | Example                                   |
| --------------------------- | ------------------------------ | ----------------------------------------- |
| `openai-api-key`            | OpenAI API key for AI features | `sk-...`                                  |
| `google-client-id`          | Google OAuth client ID         | `123...apps.googleusercontent.com`        |
| `google-client-secret`      | Google OAuth client secret     | `GOCSPX-...`                              |
| `supabase-url`              | Supabase project URL           | `https://xxx.supabase.co`                 |
| `supabase-anon-key`         | Supabase anonymous key         | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `supabase-service-role-key` | Supabase service role key      | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `pg-password`               | PostgreSQL password            | `your-secure-password`                    |

### Optional Configuration

| Parameter         | Description              | Default                 |
| ----------------- | ------------------------ | ----------------------- |
| `frontend-url`    | Frontend application URL | `http://localhost:3000` |
| `allowed-origins` | CORS allowed origins     | `http://localhost:3000` |

## 🚀 Deployment

### Development Environment

```bash
npm run deploy:dev
```

### Production Environment

```bash
npm run deploy:prod
```

The deployment will:

1. Set up AWS Parameter Store with your configuration
2. Build all Lambda functions
3. Deploy infrastructure using CloudFormation
4. Configure API Gateway endpoints

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

- **Runtime**: Node.js 18.x
- **Database**: PostgreSQL (via Supabase)
- **Storage**: AWS S3 (via Supabase Storage)
- **Authentication**: Supabase Auth
- **Deployment**: AWS SAM/CloudFormation
- **Monitoring**: AWS CloudWatch

## 🔐 Security

- All secrets stored in AWS Parameter Store
- Environment variables never contain plain-text secrets
- JWT token validation on protected endpoints
- CORS configured for frontend domains
- Input validation using Zod schemas

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Set up your local environment (`npm run setup:local`)
4. Make your changes and test locally (`npm run local:dev`)
5. Run tests (`npm run test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Guidelines

- Use TypeScript for all new code
- Follow the existing folder structure by domain
- Add tests for new functionality
- Use meaningful commit messages
- Update documentation as needed

## 📝 API Documentation

The API includes endpoints for:

- `POST /auth/sign-in` - User authentication
- `GET /auth/me` - Current user profile
- `GET /workspaces` - List user workspaces
- `POST /workspaces` - Create new workspace
- `GET /messages` - Retrieve messages
- `POST /messages` - Send message
- `POST /attachments` - Upload files
- `GET /search` - Search content

Full API documentation is available at `/docs` when running locally.

## 🐛 Troubleshooting

### Common Issues

**"Invalid URL" errors in local development**

- Ensure you've run `npm run setup:local` and configured your `config/parameters.json`
- Check that `supabase-url` is set correctly

**"Parameter not found" errors**

- Run `npm run setup:aws dev` to populate Parameter Store
- Verify your AWS credentials are configured

**Build failures**

- Ensure TypeScript compiles without errors: `npm run compile`
- Check that all dependencies are installed: `npm install`

### Getting Help

1. Check the [Issues](https://github.com/yourusername/unowned-backend/issues) page
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
- **Gabriel Stein** - _COO_ - [@gabrielstein](https://github.com/gabrielstein)

## 🙏 Acknowledgments

- Built with [AWS SAM](https://aws.amazon.com/serverless/sam/)
- Database provided by [Supabase](https://supabase.com/)
- AI capabilities powered by [OpenAI](https://openai.com/)
