USE testopt;

INSERT IGNORE INTO projects
(project_id, project_name, description)
VALUES
('P_TESTOPT', 'TestOpt Demo Project', 'Shared sample project for development');

INSERT IGNORE INTO modules
(module_id, project_id, module_name, criticality)
VALUES
('M_AUTH', 'P_TESTOPT', 'Authentication', 8),
('M_CATALOG', 'P_TESTOPT', 'Product Catalog', 5),
('M_PAYMENT', 'P_TESTOPT', 'Payment', 10),
('M_ORDER', 'P_TESTOPT', 'Order Management', 9);

INSERT IGNORE INTO module_dependencies
(project_id, source_module_id, target_module_id)
VALUES
('P_TESTOPT', 'M_PAYMENT', 'M_AUTH'),
('P_TESTOPT', 'M_ORDER', 'M_AUTH'),
('P_TESTOPT', 'M_ORDER', 'M_PAYMENT');

INSERT IGNORE INTO test_cases
(test_id, project_id, test_name, execution_time, priority, status)
VALUES
('T_LOGIN', 'P_TESTOPT', 'Login validation', 4, 'HIGH', 'ACTIVE'),
('T_CHECKOUT', 'P_TESTOPT', 'Checkout workflow', 8, 'HIGH', 'ACTIVE'),
('T_PAYFAIL', 'P_TESTOPT', 'Payment failure handling', 6, 'HIGH', 'ACTIVE'),
('T_CATALOG', 'P_TESTOPT', 'Product search', 3, 'MEDIUM', 'ACTIVE'),
('T_HISTORY', 'P_TESTOPT', 'Order history', 5, 'MEDIUM', 'ACTIVE');

INSERT IGNORE INTO test_coverage
(test_id, module_id, coverage_weight)
VALUES
('T_LOGIN', 'M_AUTH', 1.0),
('T_CHECKOUT', 'M_AUTH', 0.5),
('T_CHECKOUT', 'M_PAYMENT', 1.0),
('T_CHECKOUT', 'M_ORDER', 1.0),
('T_PAYFAIL', 'M_PAYMENT', 1.0),
('T_PAYFAIL', 'M_ORDER', 0.7),
('T_CATALOG', 'M_CATALOG', 1.0),
('T_HISTORY', 'M_AUTH', 0.3),
('T_HISTORY', 'M_ORDER', 0.8);

INSERT IGNORE INTO test_history
(test_id, total_executions, failure_count, last_execution)
VALUES
('T_LOGIN', 10, 2, '2026-10-15 11:00:00'),
('T_CHECKOUT', 8, 1, '2026-10-15 11:05:00'),
('T_PAYFAIL', 5, 2, '2026-10-14 10:00:00'),
('T_CATALOG', 12, 1, '2026-10-15 09:00:00'),
('T_HISTORY', 0, 0, NULL);

INSERT IGNORE INTO workers (worker_id, worker_status)
VALUES ('W1', 'AVAILABLE'), ('W2', 'AVAILABLE');