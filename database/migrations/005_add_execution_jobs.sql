CREATE TABLE execution_jobs (
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
