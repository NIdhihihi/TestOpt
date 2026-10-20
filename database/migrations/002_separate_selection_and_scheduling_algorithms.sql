USE testopt;

ALTER TABLE optimization_runs
    ADD COLUMN selection_algorithm VARCHAR(50) NULL AFTER change_id,
    ADD COLUMN scheduling_strategy VARCHAR(50) NULL AFTER selection_algorithm;

UPDATE optimization_runs
SET
    selection_algorithm = CASE
        WHEN algorithm IN ('GREEDY', 'KNAPSACK') THEN algorithm
        ELSE 'GREEDY'
    END,
    scheduling_strategy = CASE
        WHEN status IN ('RUNNING', 'COMPLETED', 'ERROR')
            AND algorithm IN ('FCFS', 'PRIORITY', 'GREEDY', 'LPT')
            THEN algorithm
        ELSE NULL
    END
WHERE selection_algorithm IS NULL;

ALTER TABLE optimization_runs
    MODIFY COLUMN selection_algorithm VARCHAR(50) NOT NULL;

ALTER TABLE optimization_runs
    DROP COLUMN algorithm;

ALTER TABLE selected_tests
    ADD COLUMN selection_rank INT NULL AFTER score;

UPDATE selected_tests AS selected
JOIN (
    SELECT
        run_id,
        test_id,
        ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY test_id) AS selection_rank
    FROM selected_tests
) AS ranked
    ON ranked.run_id = selected.run_id
    AND ranked.test_id = selected.test_id
SET selected.selection_rank = ranked.selection_rank;

ALTER TABLE selected_tests
    MODIFY COLUMN selection_rank INT NOT NULL;
