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
