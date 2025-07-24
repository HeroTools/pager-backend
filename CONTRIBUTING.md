# Contributing to Pager Backend

Thank you for your interest in contributing to Pager Backend! We welcome contributions from the community and are excited to collaborate with you.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

## 🤝 Code of Conduct

This project adheres to a code of conduct that we expect all contributors to follow. Please be respectful, inclusive, and constructive in all interactions.

### Our Standards

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- [Docker](https://www.docker.com/) (for local development)
- Git for version control

### First-time Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/pager-backend.git
   cd pager-backend
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/HeroTools/pager-backend.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Set up local configuration**:
   ```bash
   npm run setup:local
   ```
6. **Configure your environment** by editing `config/parameters.json`

## 🛠️ Development Setup

### Local Development

1. **Start the development server**:
   ```bash
   npm run local:dev
   ```
2. **Verify everything works** by visiting `http://localhost:8081`

### Before Making Changes

1. **Create a new branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Keep your fork updated**:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

## 🤝 How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **🐛 Bug fixes** - Fix issues or improve existing functionality
- **✨ New features** - Add new capabilities to the backend
- **📚 Documentation** - Improve README, add examples, or write guides
- **🧪 Tests** - Add or improve test coverage
- **🔧 DevOps** - Improve build processes, CI/CD, or deployment scripts
- **🎨 Code quality** - Refactoring, performance improvements, or code cleanup

### Contribution Workflow

1. **Check existing issues** to avoid duplicate work
2. **Create an issue** for new features or major changes (optional for small fixes)
3. **Fork and create a branch** from `main`
4. **Make your changes** following our coding standards
5. **Test your changes** thoroughly
6. **Submit a pull request** with a clear description

## 📝 Coding Standards

### TypeScript Guidelines

- **Use TypeScript** for all new code
- **Define proper types** - avoid `any` whenever possible
- **Use interfaces** for object shapes and API contracts
- **Leverage union types** and generics where appropriate

### Code Style

- **Formatting**: Use Prettier (run `npm run format`)
- **Linting**: Use ESLint (run `npm run lint`)
- **File naming**: Use kebab-case for files and folders
- **Function naming**: Use camelCase for functions and variables
- **Constants**: Use UPPER_SNAKE_CASE for constants

### Architecture Patterns

- **Domain organization**: Group functions by business domain
- **Single responsibility**: Each function should have one clear purpose
- **Error handling**: Use proper error handling with meaningful messages
- **Validation**: Use Zod schemas for input validation
- **Async/await**: Prefer async/await over promises

### Comments and Documentation

- **Add comments sparingly** - only for complex business logic
- **Use JSDoc** for function documentation when needed
- **Write self-documenting code** with clear variable and function names
- **Document breaking changes** in pull request descriptions

## 🔄 Pull Request Process

### Before Submitting

- [ ] Code follows the style guidelines
- [ ] Self-review of your own code
- [ ] Add tests for new functionality
- [ ] Update documentation if needed
- [ ] Run `npm run lint` and fix any issues
- [ ] Run `npm run format` to ensure consistent formatting
- [ ] Test locally with `npm run local:dev`

### Pull Request Template

When creating a pull request, please include:

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Code refactoring
- [ ] Other (please describe):

## Testing

- [ ] Tested locally
- [ ] Added new tests
- [ ] All existing tests pass

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-reviewed the code
- [ ] Updated documentation
- [ ] No breaking changes (or documented)
```

### Review Process

1. **Automated checks** must pass (linting, formatting)
2. **Manual review** by at least one maintainer
3. **Address feedback** promptly and professionally
4. **Squash commits** if requested before merging

## 🐛 Issue Guidelines

### Reporting Bugs

When reporting bugs, please include:

- **Clear title** and description
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Environment details** (Node.js version, OS, etc.)
- **Relevant logs** or error messages
- **Screenshots** if applicable

### Feature Requests

For feature requests, please provide:

- **Clear use case** and motivation
- **Detailed description** of the proposed feature
- **Possible implementation** ideas (if any)
- **Alternative solutions** you've considered

### Issue Labels

We use these labels to categorize issues:

- `bug` - Something isn't working
- `enhancement` - New feature or improvement
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `question` - General questions

## 📚 Documentation

### Documentation Standards

- **Update README** if you change setup or usage
- **Add JSDoc comments** for complex functions
- **Include examples** in documentation
- **Keep it concise** but comprehensive
- **Use proper markdown** formatting

### API Documentation

- **Document new endpoints** with examples
- **Include request/response schemas**
- **Specify authentication requirements**
- **Note any breaking changes**

## ❓ Getting Help

### Communication Channels

- **GitHub Issues** - For bugs and feature requests
- **GitHub Discussions** - For questions and general discussion
- **Pull Request Comments** - For code-specific questions

### Contact Maintainers

- **Zach Bresler** - [@zachbresler](https://github.com/zachbresler)
- **Gabriel Stein** - [@gabrielste1n](https://github.com/gabrielste1n)

### Resources

- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Supabase Documentation](https://supabase.com/docs)

## 🎉 Recognition

Contributors will be recognized in our:

- **README contributors section**
- **Release notes** for significant contributions
- **GitHub repository** with proper attribution

Thank you for contributing to Pager Backend! Your efforts help make this project better for everyone. 🚀
