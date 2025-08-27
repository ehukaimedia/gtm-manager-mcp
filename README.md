# GTM Manager MCP Server

A Model Context Protocol (MCP) server that provides comprehensive Google Tag Manager (GTM) API access. This tool enables full CRUD operations on GTM tags, variables, and triggers with proper authentication and error handling.

## Features

### Authentication
- OAuth 2.0 authentication with Google Tag Manager
- Secure token storage and management
- Automatic token refresh

### Container Operations
- List all containers in an account
- Find containers by GTM ID

### Tag Management
- List all tags in a workspace
- Create custom HTML tags
- Update existing tags
- Delete tags
- Automatic trigger assignment

### Variable Management
- List all variables
- Create Custom JavaScript variables
- Update variable code
- Delete variables

### Trigger Management
- List all triggers
- Create triggers (Page View, Click, etc.)
- Update trigger conditions
- Delete triggers

## Prerequisites

- Node.js 18.0 or higher
- npm or yarn package manager
- Google Cloud Project with Tag Manager API enabled
- OAuth 2.0 Client ID and Secret
- Access to target GTM containers

### Required OAuth Scopes

For full functionality (CRUD + submit/publish), your OAuth token must include all of:

- https://www.googleapis.com/auth/tagmanager.readonly
- https://www.googleapis.com/auth/tagmanager.edit.containers
- https://www.googleapis.com/auth/tagmanager.edit.containerversions
- https://www.googleapis.com/auth/tagmanager.publish

If scopes change, re-consent: run `npm run auth:url`, open the URL, approve, then `npm run auth:exchange -- <code>`.

## Installation

```bash
# Local development
npm install
npm run build

# Global install from local checkout
npm i -g .

# Or once published
# npm i -g gtm-manager-mcp
```

## Google Cloud Configuration

### Step 1: Enable Tag Manager API

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/)
2. Select or create a project
3. Go to **APIs & Services** → **Library**
4. Search for "Tag Manager API"
5. Click **Enable**

### Step 2: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Configure the OAuth consent screen if prompted
4. Select **Application type**: Web application
5. Add **Authorized redirect URIs**:
   ```
   http://localhost:3101/callback (for local development)
   ```
6. Save the generated **Client ID** and **Client Secret**

### Step 3: Environment Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required: Google OAuth Credentials
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3101/callback

# Optional: Default GTM Container ID
GTM_ID=GTM-XXXXXXX
```

## Local Callback and Auth (Port 3101)

1. Start the local callback server:
   ```bash
   npm run serve:callback
   # Health check: http://localhost:3101/health
   # Callback URL (served inline): http://localhost:3101/callback
   ```
2. Get the OAuth URL and authenticate:
   ```bash
   # If installed globally
   gtm-manager-auth auth:url
   # Or from source
   npm run cli -- auth:url
   # Open the printed URL, sign in, it redirects to http://localhost:3101/callback
   ```
3. Exchange the authorization code for tokens (copy the `code` from the callback page):
   ```bash
   # If installed globally
   gtm-manager-auth auth:exchange "<paste-code>"
   # Or from source
   npm run cli -- auth:exchange "<paste-code>"
   # Tokens saved to data/gtm-token.json
   ```

If you see "insufficient authentication scopes" on create/publish:
- Ensure the token includes `tagmanager.edit.containerversions` and `tagmanager.publish` (re-auth if needed).
- Confirm the GTM user has Container permissions: Edit, Approve, Publish (or Admin).

## Using as a Global MCP Tool

- After `npm i -g gtm-manager-mcp` (or `npm i -g .` locally), the binary `gtm-manager-mcp` is available on your PATH.
- Configure your MCP-compatible client to launch `gtm-manager-mcp` with env vars `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and optional `GTM_ID`.
- For local OAuth, run `gtm-manager-callback` to serve `http://localhost:3101/callback`.

### Codex CLI config example

```toml
[mcp_servers.gtm_manager]
command = "bash"
args = ["-lc", "set -a; [ -f .env ] && source .env; exec gtm-manager-mcp"]
```

Optional per-project token directory (keeps tokens within each project): set `GTM_TOKEN_DIR=.gtm` in that project’s `.env`.

## API Reference

### Health

#### `gtm_health`
Check that the server is running and env/tokens are available.

**Parameters:** None

**Returns:** Status summary with env flags and token path

### Authentication

#### `gtm_auth`
Get the OAuth authentication URL.

**Parameters:** None

**Returns:** Authentication URL to visit in browser

**Example:**
```typescript
await gtm_auth()
// Returns: "Visit this URL to authenticate: https://accounts.google.com/..."
```

#### `gtm_authenticate`
Complete authentication with the authorization code.

**Parameters:**
- `code` (string, required): Authorization code from Google OAuth

**Example:**
```typescript
await gtm_authenticate({ code: "4/0AY0e-g7..." })
```

### Container Operations

#### `gtm_list_containers`
List all containers accessible to the authenticated account.

**Parameters:**
- `accountId` (string, optional): Specific account ID to query

**Example:**
```typescript
await gtm_list_containers()
```


### Tag Operations

#### `gtm_list_tags`
List all tags in the current workspace.

**Parameters:**
- `gtmId` (string, optional): GTM container ID (uses env default if not provided)

**Example:**
```typescript
await gtm_list_tags({ gtmId: "GTM-ABC123" })
```

#### `gtm_create_tag`
Create a new HTML tag.

**Parameters:**
- `name` (string, required): Tag name
- `html` (string, required): HTML/JavaScript content
- `trigger` (string, optional): Trigger type (default: "pageview")

**Example:**
```typescript
await gtm_create_tag({
  name: "Analytics Event",
  html: "<script>console.log('Page viewed');</script>",
  trigger: "pageview"
})
```

#### `gtm_update_tag`
Update an existing tag.

**Parameters:**
- `tagId` (string, required): Tag ID to update
- `name` (string, optional): New tag name
- `html` (string, optional): New HTML content

**Example:**
```typescript
await gtm_update_tag({
  tagId: "12",
  html: "<script>console.log('Updated code');</script>"
})
```

#### `gtm_delete_tag`
Delete a tag from the workspace.

**Parameters:**
- `tagId` (string, required): Tag ID to delete

**Example:**
```typescript
await gtm_delete_tag({ tagId: "12" })
```

### Variable Operations

#### `gtm_list_variables`
List all variables in the current workspace.

**Parameters:**
- `gtmId` (string, optional): GTM container ID

**Example:**
```typescript
await gtm_list_variables()
```

#### `gtm_create_variable`
Create a new Custom JavaScript variable.

**Parameters:**
- `name` (string, required): Variable name
- `code` (string, required): JavaScript function code
- `type` (string, optional): Variable type (default: "jsm")

**Example:**
```typescript
await gtm_create_variable({
  name: "Page Title",
  code: "function() { return document.title; }"
})
```

#### `gtm_update_variable`
Update an existing variable.

**Parameters:**
- `variableId` (string, required): Variable ID to update
- `name` (string, optional): New name
- `code` (string, optional): New JavaScript code

**Example:**
```typescript
await gtm_update_variable({
  variableId: "5",
  code: "function() { return document.title.toLowerCase(); }"
})
```

#### `gtm_delete_variable`
Delete a variable from the workspace.

**Parameters:**
- `variableId` (string, required): Variable ID to delete

**Example:**
```typescript
await gtm_delete_variable({ variableId: "5" })
```

### Trigger Operations

#### `gtm_list_triggers`
List all triggers in the current workspace.

**Parameters:**
- `gtmId` (string, optional): GTM container ID

**Example:**
```typescript
await gtm_list_triggers()
```

#### `gtm_create_trigger`
Create a new trigger.

**Parameters:**
- `name` (string, required): Trigger name
- `type` (string, required): Trigger type ("pageview", "click", "formSubmit", etc.)
- `conditions` (array, optional): Trigger conditions

**Example:**
```typescript
await gtm_create_trigger({
  name: "Contact Form Submit",
  type: "formSubmit",
  conditions: [{
    type: "equals",
    parameter: [{
      type: "template",
      key: "formId",
      value: "contact-form"
    }]
  }]
})
```

## Error Handling

The MCP server provides detailed error messages for common issues:

### Authentication Errors
- `Missing required environment variables`: Check your `.env` file
- `Invalid authorization code`: The OAuth code may have expired
- `Token refresh failed`: Re-authenticate using `gtm_auth`

### API Errors
- `Container not found`: Verify GTM ID and permissions
- `Workspace not found`: Container may not have an active workspace
- `Permission denied`: Check account access to the container
- `Invalid tag/variable ID`: Verify the ID exists in the workspace

### Common Solutions

1. Re-authenticate if you see permission errors
2. Check GTM permissions in Tag Manager interface
3. Verify API is enabled in Google Cloud Console

## Best Practices

### Security
- Never commit `.env` files to version control
- Use environment-specific redirect URIs
- Regularly rotate OAuth credentials
- Limit API permissions to required scopes

### Workspace Management
- Always preview changes in GTM interface before publishing
- Use descriptive names for tags and variables
- Document complex JavaScript in variables
- Test in GTM Preview mode before going live
- Publish changes manually through the GTM web interface

### Performance
- Batch operations when possible
- Cache container information locally
- Minimize API calls by listing before updating

## Development

### Running Tests
```bash
npm test
```

### Building from Source
```bash
npm run build
```

### Development Mode
```bash
npm run dev
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issue tracker.
