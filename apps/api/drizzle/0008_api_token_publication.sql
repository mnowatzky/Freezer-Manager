-- Sync API tokens to their owner (Settings → API tokens), but never the token hash.
ALTER PUBLICATION zero_app ADD TABLE api_token (id, user_id, name, prefix, scope, created_at, last_used_at, revoked_at);
