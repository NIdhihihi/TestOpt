CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    family_id VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    max_expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    replaced_by_id VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_refresh_user (user_id),
    INDEX idx_refresh_family (family_id),
    INDEX idx_refresh_expires (expires_at)
);

UPDATE users SET auth_provider_id = NULL WHERE auth_provider = 'LOCAL' AND auth_provider_id = '';

-- Grandfather local password accounts created prior to OTP-verified registration
UPDATE users SET email_verified = TRUE WHERE auth_provider = 'LOCAL' AND password_hash IS NOT NULL AND email_verified = FALSE;

ALTER TABLE users
    ADD UNIQUE INDEX idx_users_oauth_provider (auth_provider, auth_provider_id);

