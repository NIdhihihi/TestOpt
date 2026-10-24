import test from "node:test";
import assert from "node:assert/strict";
import {
  RUN_STATES,
  TEST_STATES,
  validateRunTransition,
  validateTestTransition,
} from "./stateMachine.js";

test("validates valid run state sequence: CONFIGURED -> ANALYZING_IMPACT -> VALUING_TESTS -> SELECTING_TESTS -> SCHEDULING -> PLAN_READY -> EXECUTING -> COMPLETED", () => {
  const sequence = [
    RUN_STATES.CONFIGURED,
    RUN_STATES.ANALYZING_IMPACT,
    RUN_STATES.VALUING_TESTS,
    RUN_STATES.SELECTING_TESTS,
    RUN_STATES.SCHEDULING,
    RUN_STATES.PLAN_READY,
    RUN_STATES.EXECUTING,
    RUN_STATES.COMPLETED,
  ];

  for (let i = 0; i < sequence.length - 1; i++) {
    assert.doesNotThrow(() => validateRunTransition(sequence[i], sequence[i + 1]));
  }
});

test("validates direct transition to NO_TESTS_REQUIRED from ANALYZING_IMPACT or SELECTING_TESTS", () => {
  assert.doesNotThrow(() => validateRunTransition(RUN_STATES.ANALYZING_IMPACT, RUN_STATES.NO_TESTS_REQUIRED));
  assert.doesNotThrow(() => validateRunTransition(RUN_STATES.SELECTING_TESTS, RUN_STATES.NO_TESTS_REQUIRED));
});

test("validates plan rejection and re-scheduling lifecycle", () => {
  assert.doesNotThrow(() => validateRunTransition(RUN_STATES.PLAN_READY, RUN_STATES.PLAN_REJECTED));
  assert.doesNotThrow(() => validateRunTransition(RUN_STATES.PLAN_REJECTED, RUN_STATES.SCHEDULING));
  assert.doesNotThrow(() => validateRunTransition(RUN_STATES.PLAN_REJECTED, RUN_STATES.PLAN_READY));
});

test("rejects invalid run state transitions", () => {
  assert.throws(
    () => validateRunTransition(RUN_STATES.CONFIGURED, RUN_STATES.COMPLETED),
    /Invalid run state transition/
  );
  assert.throws(
    () => validateRunTransition(RUN_STATES.COMPLETED, RUN_STATES.EXECUTING),
    /Invalid run state transition/
  );
  assert.throws(
    () => validateRunTransition(RUN_STATES.PLAN_READY, RUN_STATES.CONFIGURED),
    /Invalid run state transition/
  );
});

test("validates valid test state sequence: SELECTED -> ASSIGNED -> RUNNING -> PASSED/FAILED/ERROR -> RECORDED", () => {
  const passedPath = [
    TEST_STATES.SELECTED,
    TEST_STATES.ASSIGNED,
    TEST_STATES.RUNNING,
    TEST_STATES.PASSED,
    TEST_STATES.RECORDED,
  ];

  for (let i = 0; i < passedPath.length - 1; i++) {
    assert.doesNotThrow(() => validateTestTransition(passedPath[i], passedPath[i + 1]));
  }

  const failedPath = [
    TEST_STATES.SELECTED,
    TEST_STATES.ASSIGNED,
    TEST_STATES.RUNNING,
    TEST_STATES.FAILED,
    TEST_STATES.RECORDED,
  ];

  for (let i = 0; i < failedPath.length - 1; i++) {
    assert.doesNotThrow(() => validateTestTransition(failedPath[i], failedPath[i + 1]));
  }

  const errorPath = [
    TEST_STATES.SELECTED,
    TEST_STATES.ASSIGNED,
    TEST_STATES.RUNNING,
    TEST_STATES.ERROR,
    TEST_STATES.RECORDED,
  ];

  for (let i = 0; i < errorPath.length - 1; i++) {
    assert.doesNotThrow(() => validateTestTransition(errorPath[i], errorPath[i + 1]));
  }
});

test("rejects invalid test state transitions", () => {
  assert.throws(
    () => validateTestTransition(TEST_STATES.SELECTED, TEST_STATES.RECORDED),
    /Invalid test state transition/
  );
  assert.throws(
    () => validateTestTransition(TEST_STATES.RECORDED, TEST_STATES.RUNNING),
    /Invalid test state transition/
  );
  assert.throws(
    () => validateTestTransition(TEST_STATES.PASSED, TEST_STATES.RUNNING),
    /Invalid test state transition/
  );
});
