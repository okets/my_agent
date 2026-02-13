# /my-agent:auth

Re-run the authentication setup step. Configure how your agent authenticates with Anthropic.

When the user types `/my-agent:auth`, this presents the auth method choice (API key or Claude subscription), validates the credentials, and stores them in `auth.json`.

Supports: API key (pay-per-use) or Claude subscription setup-token (Pro/Max plan).
