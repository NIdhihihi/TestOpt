USE testopt;

-- Align selected_tests with the fine-grained Test State lifecycle (SRS REQ-4.9.6):
-- SELECTED -> ASSIGNED -> RUNNING -> PASSED / FAILED / ERROR -> RECORDED
ALTER TABLE selected_tests
    ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'SELECTED' AFTER selection_reason;
