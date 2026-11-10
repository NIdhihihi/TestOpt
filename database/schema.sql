CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NULL,
    role ENUM('DEVELOPER', 'TEST_MANAGER', 'ADMIN') NOT NULL DEFAULT 'DEVELOPER',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    auth_provider ENUM('LOCAL', 'GOOGLE', 'GITHUB') NOT NULL DEFAULT 'LOCAL',
    auth_provider_id VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE INDEX idx_users_oauth_provider (auth_provider, auth_provider_id)
);

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

CREATE TABLE IF NOT EXISTS organizations (
    organization_id VARCHAR(50) PRIMARY KEY,
    organization_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    role ENUM('OWNER', 'ADMIN', 'TEST_MANAGER', 'DEVELOPER', 'VIEWER') NOT NULL DEFAULT 'DEVELOPER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
    project_id VARCHAR(50) PRIMARY KEY,
    organization_id VARCHAR(50) NOT NULL,
    project_name VARCHAR(150) NOT NULL,
    archived_at DATETIME NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_projects_organization
        FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);

CREATE TABLE IF NOT EXISTS modules (
    module_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    module_name VARCHAR(150) NOT NULL,
    criticality INT NOT NULL CHECK (criticality BETWEEN 1 AND 10),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

CREATE TABLE IF NOT EXISTS module_dependencies (
    project_id VARCHAR(50) NOT NULL,
    source_module_id VARCHAR(50) NOT NULL,
    target_module_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (project_id, source_module_id, target_module_id),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (source_module_id) REFERENCES modules(module_id),
    FOREIGN KEY (target_module_id) REFERENCES modules(module_id)
);

CREATE TABLE IF NOT EXISTS test_cases (
    test_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    test_name VARCHAR(150) NOT NULL,
    execution_time DECIMAL(8,2) NOT NULL,
    priority ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL,
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    CHECK (execution_time > 0)
);

CREATE TABLE IF NOT EXISTS test_coverage (
    test_id VARCHAR(50) NOT NULL,
    module_id VARCHAR(50) NOT NULL,
    coverage_weight DECIMAL(4,3) NOT NULL,
    PRIMARY KEY (test_id, module_id),
    FOREIGN KEY (test_id) REFERENCES test_cases(test_id),
    FOREIGN KEY (module_id) REFERENCES modules(module_id),
    CHECK (coverage_weight >= 0 AND coverage_weight <= 1)
);

CREATE TABLE IF NOT EXISTS code_changes (
    change_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    description TEXT,
    changed_module_ids JSON,
    time_budget DECIMAL(8,2) NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    CHECK (time_budget >= 0)
);

CREATE TABLE IF NOT EXISTS testing_constraints (
    project_id VARCHAR(50) PRIMARY KEY,
    w1 DECIMAL(4,3) NOT NULL DEFAULT 0.350,
    w2 DECIMAL(4,3) NOT NULL DEFAULT 0.250,
    w3 DECIMAL(4,3) NOT NULL DEFAULT 0.150,
    w4 DECIMAL(4,3) NOT NULL DEFAULT 0.250,
    default_budget DECIMAL(8,2) NOT NULL DEFAULT 15.00,
    max_workers INT NOT NULL DEFAULT 2,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS code_change_modules (
    change_id VARCHAR(50) NOT NULL,
    module_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (change_id, module_id),
    FOREIGN KEY (change_id)
        REFERENCES code_changes(change_id)
        ON DELETE CASCADE,
    FOREIGN KEY (module_id)
        REFERENCES modules(module_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS optimization_runs (
    run_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    change_id VARCHAR(50),
    selection_algorithm VARCHAR(50) NOT NULL,
    scheduling_strategy VARCHAR(50),
    time_budget DECIMAL(8,2) NOT NULL,
    worker_count INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (change_id) REFERENCES code_changes(change_id)
);

CREATE TABLE IF NOT EXISTS selected_tests (
    run_id VARCHAR(50) NOT NULL,
    test_id VARCHAR(50) NOT NULL,
    score DECIMAL(12,5) NOT NULL DEFAULT 0,
    selection_rank INT NOT NULL,
    selection_reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'SELECTED',
    PRIMARY KEY (run_id, test_id),
    FOREIGN KEY (run_id) REFERENCES optimization_runs(run_id),
    FOREIGN KEY (test_id) REFERENCES test_cases(test_id)
);

CREATE TABLE IF NOT EXISTS workers (
    worker_id VARCHAR(50) PRIMARY KEY,
    worker_status ENUM('AVAILABLE', 'BUSY', 'UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE'
);

CREATE TABLE IF NOT EXISTS test_executions (
    execution_id VARCHAR(50) PRIMARY KEY,
    run_id VARCHAR(50) NOT NULL,
    test_id VARCHAR(50) NOT NULL,
    worker_id VARCHAR(50),
    execution_status ENUM('PASSED', 'FAILED', 'ERROR', 'NOT_RUN') NOT NULL,
    actual_time DECIMAL(8,2),
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (run_id, test_id)
        REFERENCES selected_tests(run_id, test_id),
    FOREIGN KEY (worker_id) REFERENCES workers(worker_id)
);

CREATE TABLE IF NOT EXISTS execution_jobs (
    job_id VARCHAR(50) PRIMARY KEY,
    run_id VARCHAR(50) NOT NULL,
    requested_by_user_id VARCHAR(50) NOT NULL,
    queue_status ENUM('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    attempt_count INT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    queued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    FOREIGN KEY (run_id) REFERENCES optimization_runs(run_id),
    FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id),
    INDEX idx_execution_jobs_status (queue_status, queued_at)
);

CREATE TABLE IF NOT EXISTS test_history (
    test_id VARCHAR(50) PRIMARY KEY,
    total_executions INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    last_execution DATETIME,
    FOREIGN KEY (test_id) REFERENCES test_cases(test_id),
    CHECK (total_executions >= 0),
    CHECK (failure_count >= 0 AND failure_count <= total_executions)
);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id VARCHAR(50) PRIMARY KEY,
    organization_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(50) NOT NULL,
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_organization_created (organization_id, created_at),
    INDEX idx_audit_resource (resource_type, resource_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS project_runner_configs (
    project_id VARCHAR(50) PRIMARY KEY,
    runner_type ENUM('NPM') NOT NULL DEFAULT 'NPM',
    workspace_path VARCHAR(255) NOT NULL,
    command_name VARCHAR(80) NOT NULL DEFAULT 'npm',
    command_args JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_versions (
    version_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    previous_version_id VARCHAR(50) NULL,
    files JSON NOT NULL,
    analysis JSON NOT NULL,
    evidence JSON NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    INDEX idx_source_project (project_id, created_at)
);

CREATE TABLE IF NOT EXISTS source_plans (
    plan_id VARCHAR(50) PRIMARY KEY,
    version_id VARCHAR(50) NOT NULL,
    project_id VARCHAR(50) NOT NULL,
    plan JSON NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
    results JSON NOT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    completed_at DATETIME NULL,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (version_id) REFERENCES source_versions(version_id),
    INDEX idx_source_plan_project (project_id, created_at)
);

CREATE TABLE IF NOT EXISTS source_test_history (
    project_id VARCHAR(50) NOT NULL,
    test_path VARCHAR(240) NOT NULL,
    total_executions INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    estimated_time DECIMAL(10,5) NOT NULL DEFAULT 0.02,
    last_execution DATETIME NULL,
    PRIMARY KEY (project_id, test_path),
    FOREIGN KEY (project_id) REFERENCES projects(project_id)
);
