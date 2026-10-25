CREATE TABLE project_runner_configs (
    project_id VARCHAR(50) PRIMARY KEY,
    runner_type ENUM('NPM') NOT NULL DEFAULT 'NPM',
    workspace_path VARCHAR(255) NOT NULL,
    command_name VARCHAR(80) NOT NULL DEFAULT 'npm',
    command_args JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

INSERT INTO project_runner_configs (project_id, runner_type, workspace_path, command_name, command_args)
SELECT 'P_TESTOPT', 'NPM', 'backend', 'npm', JSON_ARRAY('test')
WHERE EXISTS (SELECT 1 FROM projects WHERE project_id = 'P_TESTOPT')
  AND NOT EXISTS (SELECT 1 FROM project_runner_configs WHERE project_id = 'P_TESTOPT');
