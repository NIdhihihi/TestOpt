USE testopt;

-- SRS §6.1: Formalize code_changes table with description, changed_module_ids, and submitted_at
ALTER TABLE code_changes
    ADD COLUMN description TEXT NULL AFTER project_id,
    ADD COLUMN changed_module_ids JSON NULL AFTER description,
    ADD COLUMN submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER time_budget;

-- SRS §6.1: Formalize testing_constraints configuration table
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

-- Seed default project constraints for P_TESTOPT if project exists
INSERT INTO testing_constraints (project_id, w1, w2, w3, w4, default_budget, max_workers)
SELECT 'P_TESTOPT', 0.350, 0.250, 0.150, 0.250, 15.00, 2
WHERE EXISTS (SELECT 1 FROM projects WHERE project_id = 'P_TESTOPT')
  AND NOT EXISTS (SELECT 1 FROM testing_constraints WHERE project_id = 'P_TESTOPT');
