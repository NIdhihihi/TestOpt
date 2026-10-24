/**
 * TestOpt State Machine Engine
 * Reference: SRS REQ-4.9.6, State Diagram Page 4, BR-8
 *
 * Enforces valid run states and test execution states:
 * Run states:  CONFIGURED -> ANALYZING_IMPACT -> VALUING_TESTS -> SELECTING_TESTS -> SCHEDULING -> PLAN_READY -> EXECUTING -> COMPLETED
 * Test states: SELECTED -> ASSIGNED -> RUNNING -> PASSED / FAILED / ERROR -> RECORDED
 */

export const RUN_STATES = Object.freeze({
  CONFIGURED: "CONFIGURED",
  ANALYZING_IMPACT: "ANALYZING_IMPACT",
  VALUING_TESTS: "VALUING_TESTS",
  SELECTING_TESTS: "SELECTING_TESTS",
  SCHEDULING: "SCHEDULING",
  PLAN_READY: "PLAN_READY",
  PLAN_REJECTED: "PLAN_REJECTED",
  EXECUTING: "EXECUTING",
  COMPLETED: "COMPLETED",
  NO_TESTS_REQUIRED: "NO_TESTS_REQUIRED",
  ERROR: "ERROR",
  // Backward compatibility aliases
  SELECTED: "SELECTED",
  RUNNING: "RUNNING",
});

export const TEST_STATES = Object.freeze({
  SELECTED: "SELECTED",
  ASSIGNED: "ASSIGNED",
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
  ERROR: "ERROR",
  RECORDED: "RECORDED",
});

export const VALID_RUN_TRANSITIONS = new Map([
  [RUN_STATES.CONFIGURED, new Set([RUN_STATES.ANALYZING_IMPACT, RUN_STATES.ERROR])],
  [RUN_STATES.ANALYZING_IMPACT, new Set([RUN_STATES.VALUING_TESTS, RUN_STATES.NO_TESTS_REQUIRED, RUN_STATES.ERROR])],
  [RUN_STATES.VALUING_TESTS, new Set([RUN_STATES.SELECTING_TESTS, RUN_STATES.ERROR])],
  [RUN_STATES.SELECTING_TESTS, new Set([RUN_STATES.SCHEDULING, RUN_STATES.PLAN_READY, RUN_STATES.SELECTED, RUN_STATES.NO_TESTS_REQUIRED, RUN_STATES.ERROR])],
  [RUN_STATES.SCHEDULING, new Set([RUN_STATES.PLAN_READY, RUN_STATES.SELECTED, RUN_STATES.ERROR])],
  [RUN_STATES.PLAN_READY, new Set([RUN_STATES.SCHEDULING, RUN_STATES.PLAN_REJECTED, RUN_STATES.EXECUTING, RUN_STATES.RUNNING, RUN_STATES.ERROR])],
  [RUN_STATES.PLAN_REJECTED, new Set([RUN_STATES.SCHEDULING, RUN_STATES.PLAN_READY, RUN_STATES.ERROR])],
  [RUN_STATES.SELECTED, new Set([RUN_STATES.SCHEDULING, RUN_STATES.PLAN_READY, RUN_STATES.EXECUTING, RUN_STATES.RUNNING, RUN_STATES.ERROR])],
  [RUN_STATES.EXECUTING, new Set([RUN_STATES.COMPLETED, RUN_STATES.ERROR])],
  [RUN_STATES.RUNNING, new Set([RUN_STATES.COMPLETED, RUN_STATES.ERROR])],
  [RUN_STATES.COMPLETED, new Set([])],
  [RUN_STATES.NO_TESTS_REQUIRED, new Set([])],
  [RUN_STATES.ERROR, new Set([])],
]);

export const VALID_TEST_TRANSITIONS = new Map([
  [TEST_STATES.SELECTED, new Set([TEST_STATES.ASSIGNED, TEST_STATES.RUNNING, TEST_STATES.ERROR])],
  [TEST_STATES.ASSIGNED, new Set([TEST_STATES.RUNNING, TEST_STATES.ASSIGNED, TEST_STATES.ERROR])],
  [TEST_STATES.RUNNING, new Set([TEST_STATES.PASSED, TEST_STATES.FAILED, TEST_STATES.ERROR])],
  [TEST_STATES.PASSED, new Set([TEST_STATES.RECORDED])],
  [TEST_STATES.FAILED, new Set([TEST_STATES.RECORDED])],
  [TEST_STATES.ERROR, new Set([TEST_STATES.RECORDED])],
  [TEST_STATES.RECORDED, new Set([])],
]);

export function validateRunTransition(fromState, toState) {
  const allowed = VALID_RUN_TRANSITIONS.get(fromState);
  if (allowed && fromState === toState) return true;
  if (!allowed || !allowed.has(toState)) {
    const error = new Error(`Invalid run state transition from '${fromState}' to '${toState}'.`);
    error.statusCode = 409;
    error.code = "INVALID_RUN_STATE_TRANSITION";
    throw error;
  }
  return true;
}

export function validateTestTransition(fromState, toState) {
  const allowed = VALID_TEST_TRANSITIONS.get(fromState);
  if (allowed && fromState === toState) return true;
  if (!allowed || !allowed.has(toState)) {
    const error = new Error(`Invalid test state transition from '${fromState}' to '${toState}'.`);
    error.statusCode = 409;
    error.code = "INVALID_TEST_STATE_TRANSITION";
    throw error;
  }
  return true;
}

/**
 * Persists a validated run state transition.
 */
export async function transitionRunState(connection, runId, nextState) {
  const [runs] = await connection.query(
    "SELECT status FROM optimization_runs WHERE run_id = ? FOR UPDATE",
    [runId]
  );
  if (runs.length === 0) {
    const error = new Error(`Optimization run ${runId} was not found.`);
    error.statusCode = 404;
    throw error;
  }

  const currentState = runs[0].status;
  validateRunTransition(currentState, nextState);

  await connection.query(
    "UPDATE optimization_runs SET status = ? WHERE run_id = ?",
    [nextState, runId]
  );
  return { previousState: currentState, nextState };
}

/**
 * Persists a validated test state transition for a given test in a run.
 */
export async function transitionTestState(connection, runId, testId, nextState) {
  const [tests] = await connection.query(
    "SELECT status FROM selected_tests WHERE run_id = ? AND test_id = ? FOR UPDATE",
    [runId, testId]
  );
  if (tests.length === 0) {
    const error = new Error(`Selected test ${testId} for run ${runId} was not found.`);
    error.statusCode = 404;
    throw error;
  }

  const currentState = tests[0].status;
  validateTestTransition(currentState, nextState);

  await connection.query(
    "UPDATE selected_tests SET status = ? WHERE run_id = ? AND test_id = ?",
    [nextState, runId, testId]
  );
  return { previousState: currentState, nextState };
}
