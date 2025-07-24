---
name: Bug Report
about: Report a bug to help us improve Pager Backend
title: '[BUG] Brief description of the issue'
labels: ['bug', 'needs-triage']
assignees: ''
---

## Bug Description

A clear and concise description of what the bug is.

## Steps to Reproduce

1. Send request to '...'
2. With payload '...'
3. Using endpoint '...'
4. See error

## Expected Behavior

A clear description of what you expected to happen.

## Actual Behavior

A clear description of what actually happened instead.

## API Request/Response

If applicable, include the relevant API request and response:

**Request:**

```http
POST /api/endpoint
Content-Type: application/json
Authorization: Bearer [token]

{
  "example": "payload"
}
```

**Response:**

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Error message here"
}
```

## Environment

**Local Development:**

- Node.js Version: [e.g. 18.17.0]
- npm Version: [e.g. 9.6.7]
- SAM CLI Version: [e.g. 1.100.0]
- Docker Version: [e.g. 24.0.6]
- OS: [e.g. macOS 14.1, Windows 11, Ubuntu 22.04]

**AWS Environment:**

- Environment: [dev/prod]
- Region: [e.g. us-east-1]
- Lambda Runtime: [e.g. nodejs18.x]

**Application:**

- Version: [e.g. commit hash or release version]
- Branch: [e.g. main, develop]

## Logs and Errors

**Lambda Function Logs (CloudWatch):**

```
Paste relevant Lambda logs here
```

**Local Development Logs:**

```
Paste local sam logs here
```

**Build/Deployment Errors:**

```
Paste build or deployment errors here
```

## Function/Endpoint Affected

- Function Name: [e.g. auth-sign-in, workspaces-create]
- API Endpoint: [e.g. POST /auth/sign-in]
- HTTP Method: [GET/POST/PUT/DELETE]

## Reproducibility

- [ ] This happens every time
- [ ] This happens sometimes
- [ ] This happened once
- [ ] I can't reproduce it consistently

## Configuration

**Affected Services:**

- [ ] Authentication
- [ ] Workspaces
- [ ] Messages
- [ ] Attachments
- [ ] Notifications
- [ ] Search
- [ ] Embeddings

**External Dependencies:**

- [ ] Supabase Database
- [ ] OpenAI API
- [ ] AWS Secrets Manager
- [ ] Other: \***\*\_\_\_\_\*\***

## Workaround

If you found a temporary workaround, please describe it here.

## Additional Context

Add any other context about the problem here. This might include:

- When did this start happening?
- Did it work before?
- Are there any related issues?
- Specific workspace/user where it occurs?
- Does it happen in both dev and prod?

## Impact

How does this bug affect the backend functionality?

- [ ] Critical - Service completely down
- [ ] High - Core functionality broken
- [ ] Medium - Feature partially working
- [ ] Low - Minor issue or edge case

## Database State

If relevant, include information about database state or specific records that trigger the issue:

```sql
-- Example query or data that reproduces the issue
SELECT * FROM table WHERE condition;
```
