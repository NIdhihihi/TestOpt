-- 011_add_auth_oauth_and_email_verification.sql
-- Enables real-time email OTP verification and Google/GitHub OAuth 2.0 federation

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_provider ENUM('LOCAL', 'GOOGLE', 'GITHUB') NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255) NULL,
  MODIFY COLUMN password_hash VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'REGISTRATION',
  expires_at DATETIME NOT NULL,
  attempts_remaining INT NOT NULL DEFAULT 5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_verification (email, expires_at)
);

