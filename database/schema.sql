CREATE DATABASE IF NOT EXISTS testopt;
USE testopt;

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('DEVELOPER', 'TEST_MANAGER', 'ADMIN') NOT NULL DEFAULT 'DEVELOPER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    project_id VARCHAR(50) PRIMARY KEY,
    project_name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    time_budget DECIMAL(8,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    CHECK (time_budget >= 0)
);

CREATE TABLE IF NOT EXISTS optimization_runs (
    run_id VARCHAR(50) PRIMARY KEY,
    project_id VARCHAR(50) NOT NULL,
    change_id VARCHAR(50),
    algorithm VARCHAR(50) NOT NULL,
    time_budget DECIMAL(8,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id),
    FOREIGN KEY (change_id) REFERENCES code_changes(change_id)
);

CREATE TABLE IF NOT EXISTS selected_tests (
    run_id VARCHAR(50) NOT NULL,
    test_id VARCHAR(50) NOT NULL,
    score DECIMAL(12,5) NOT NULL DEFAULT 0,
    selection_reason TEXT,
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

CREATE TABLE IF NOT EXISTS test_history (
    test_id VARCHAR(50) PRIMARY KEY,
    total_executions INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    last_execution DATETIME,
    FOREIGN KEY (test_id) REFERENCES test_cases(test_id),
    CHECK (total_executions >= 0),
    CHECK (failure_count >= 0 AND failure_count <= total_executions)
);