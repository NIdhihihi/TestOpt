USE testopt;

ALTER TABLE optimization_runs
ADD COLUMN worker_count INT NOT NULL DEFAULT 1
AFTER time_budget;
