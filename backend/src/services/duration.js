export const MILLISECONDS_PER_MINUTE = 60_000;
export const DURATION_PRECISION = Object.freeze({ unit: 'MILLISECOND', costs: 'ROUND_UP', budget: 'ROUND_DOWN' });

// Repair only binary representation noise around an integer millisecond.
// Genuine sub-millisecond inputs remain conservative: costs up, budgets down.
function scaledMilliseconds(minutes) {
  const value = Number(minutes) * MILLISECONDS_PER_MINUTE;
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new RangeError('Duration must be finite, non-negative, and within safe millisecond precision.');
  const integer = Math.round(value);
  const tolerance = Math.min(1e-6, Number.EPSILON * Math.max(1, value) * 4);
  return Math.abs(value - integer) <= tolerance ? integer : value;
}

export function durationMilliseconds(minutes) {
  if (!(Number(minutes) > 0)) throw new RangeError('Execution duration must be positive.');
  return Math.max(1, Math.ceil(scaledMilliseconds(minutes)));
}

export function budgetMilliseconds(minutes) { return Math.floor(scaledMilliseconds(minutes)); }
export function millisecondsToMinutes(value) { return value / MILLISECONDS_PER_MINUTE; }

export function sumMilliseconds(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) throw new RangeError('Combined duration exceeds safe millisecond precision.');
    total += value;
  }
  return total;
}

export function selectedDurationMilliseconds(selected) { return sumMilliseconds(selected.map(item => durationMilliseconds(item.executionTime))); }
export function selectedDurationMinutes(selected) { return millisecondsToMinutes(selectedDurationMilliseconds(selected)); }

export function assertSelectionBudget(selected, budget) {
  if (selectedDurationMilliseconds(selected) > budgetMilliseconds(budget)) throw new Error('Selected estimated durations exceed the requested budget.');
  return selected;
}
