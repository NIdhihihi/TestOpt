USE testopt;

INSERT IGNORE INTO projects (project_id, project_name, description) VALUES
('P_TESTOPT', 'TestOpt Demo Project', 'Shared sample project for development'),
('P_RETAIL', 'Retail checkout platform', 'Production-like retail workflow data for evaluating impact analysis and regression-test selection.');

INSERT IGNORE INTO modules (module_id, project_id, module_name, criticality) VALUES
('M_AUTH', 'P_TESTOPT', 'Authentication', 8), ('M_CATALOG', 'P_TESTOPT', 'Product Catalog', 5), ('M_PAYMENT', 'P_TESTOPT', 'Payment', 10), ('M_ORDER', 'P_TESTOPT', 'Order Management', 9),
('R_IDENTITY', 'P_RETAIL', 'Customer Identity', 9), ('R_CATALOG', 'P_RETAIL', 'Product Catalog', 6), ('R_CART', 'P_RETAIL', 'Shopping Cart', 8), ('R_PRICING', 'P_RETAIL', 'Pricing and Promotions', 9), ('R_INVENTORY', 'P_RETAIL', 'Inventory', 10), ('R_CHECKOUT', 'P_RETAIL', 'Checkout Orchestration', 10), ('R_PAYMENT', 'P_RETAIL', 'Payment Gateway', 10), ('R_FULFILL', 'P_RETAIL', 'Fulfillment', 8);

INSERT IGNORE INTO module_dependencies (project_id, source_module_id, target_module_id) VALUES
('P_TESTOPT', 'M_PAYMENT', 'M_AUTH'), ('P_TESTOPT', 'M_ORDER', 'M_AUTH'), ('P_TESTOPT', 'M_ORDER', 'M_PAYMENT'),
('P_RETAIL', 'R_CART', 'R_CATALOG'), ('P_RETAIL', 'R_CART', 'R_PRICING'), ('P_RETAIL', 'R_CHECKOUT', 'R_IDENTITY'), ('P_RETAIL', 'R_CHECKOUT', 'R_CART'), ('P_RETAIL', 'R_CHECKOUT', 'R_INVENTORY'), ('P_RETAIL', 'R_CHECKOUT', 'R_PAYMENT'), ('P_RETAIL', 'R_FULFILL', 'R_CHECKOUT'), ('P_RETAIL', 'R_FULFILL', 'R_INVENTORY');

INSERT IGNORE INTO test_cases (test_id, project_id, test_name, execution_time, priority, status) VALUES
('T_LOGIN', 'P_TESTOPT', 'Login validation', 4, 'HIGH', 'ACTIVE'), ('T_CHECKOUT', 'P_TESTOPT', 'Checkout workflow', 8, 'HIGH', 'ACTIVE'), ('T_PAYFAIL', 'P_TESTOPT', 'Payment failure handling', 6, 'HIGH', 'ACTIVE'), ('T_CATALOG', 'P_TESTOPT', 'Product search', 3, 'MEDIUM', 'ACTIVE'), ('T_HISTORY', 'P_TESTOPT', 'Order history', 5, 'MEDIUM', 'ACTIVE'),
('RT_LOGIN', 'P_RETAIL', 'Customer sign-in and session renewal', 4, 'HIGH', 'ACTIVE'), ('RT_CART', 'P_RETAIL', 'Add, remove, and update cart items', 5, 'HIGH', 'ACTIVE'), ('RT_PROMO', 'P_RETAIL', 'Promotion code and price recalculation', 6, 'HIGH', 'ACTIVE'), ('RT_STOCK', 'P_RETAIL', 'Inventory reservation conflict handling', 7, 'HIGH', 'ACTIVE'), ('RT_PAY', 'P_RETAIL', 'Card authorization decline recovery', 8, 'HIGH', 'ACTIVE'), ('RT_CHECKOUT', 'P_RETAIL', 'Guest checkout to order confirmation', 12, 'HIGH', 'ACTIVE'), ('RT_FULFILL', 'P_RETAIL', 'Order handoff to fulfillment', 6, 'MEDIUM', 'ACTIVE'), ('RT_SEARCH', 'P_RETAIL', 'Catalog search and availability filter', 4, 'MEDIUM', 'ACTIVE');

INSERT IGNORE INTO test_coverage (test_id, module_id, coverage_weight) VALUES
('T_LOGIN', 'M_AUTH', 1.0), ('T_CHECKOUT', 'M_AUTH', 0.5), ('T_CHECKOUT', 'M_PAYMENT', 1.0), ('T_CHECKOUT', 'M_ORDER', 1.0), ('T_PAYFAIL', 'M_PAYMENT', 1.0), ('T_PAYFAIL', 'M_ORDER', 0.7), ('T_CATALOG', 'M_CATALOG', 1.0), ('T_HISTORY', 'M_AUTH', 0.3), ('T_HISTORY', 'M_ORDER', 0.8),
('RT_LOGIN', 'R_IDENTITY', 1.0), ('RT_CART', 'R_CART', 1.0), ('RT_CART', 'R_CATALOG', 0.5), ('RT_PROMO', 'R_PRICING', 1.0), ('RT_PROMO', 'R_CART', 0.6), ('RT_STOCK', 'R_INVENTORY', 1.0), ('RT_PAY', 'R_PAYMENT', 1.0), ('RT_PAY', 'R_CHECKOUT', 0.7), ('RT_CHECKOUT', 'R_IDENTITY', 0.5), ('RT_CHECKOUT', 'R_CART', 0.8), ('RT_CHECKOUT', 'R_INVENTORY', 0.8), ('RT_CHECKOUT', 'R_PAYMENT', 1.0), ('RT_CHECKOUT', 'R_CHECKOUT', 1.0), ('RT_FULFILL', 'R_FULFILL', 1.0), ('RT_FULFILL', 'R_CHECKOUT', 0.6), ('RT_SEARCH', 'R_CATALOG', 1.0), ('RT_SEARCH', 'R_INVENTORY', 0.4);

INSERT IGNORE INTO test_history (test_id, total_executions, failure_count, last_execution) VALUES
('T_LOGIN', 10, 2, '2026-10-15 11:00:00'), ('T_CHECKOUT', 8, 1, '2026-10-15 11:05:00'), ('T_PAYFAIL', 5, 2, '2026-10-14 10:00:00'), ('T_CATALOG', 12, 1, '2026-10-15 09:00:00'), ('T_HISTORY', 0, 0, NULL),
('RT_LOGIN', 48, 2, '2026-10-20 09:15:00'), ('RT_CART', 44, 3, '2026-10-20 09:20:00'), ('RT_PROMO', 36, 5, '2026-10-19 16:40:00'), ('RT_STOCK', 31, 6, '2026-10-20 10:05:00'), ('RT_PAY', 42, 7, '2026-10-20 10:30:00'), ('RT_CHECKOUT', 40, 4, '2026-10-20 11:10:00'), ('RT_FULFILL', 38, 1, '2026-10-20 11:35:00'), ('RT_SEARCH', 52, 2, '2026-10-20 08:45:00');

INSERT IGNORE INTO workers (worker_id, worker_status) VALUES ('W1', 'AVAILABLE'), ('W2', 'AVAILABLE');
