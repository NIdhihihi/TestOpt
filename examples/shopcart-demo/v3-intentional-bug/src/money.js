export function assertCents(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('Amount must be non-negative integer cents.');
  return value;
}
export function formatMoney(cents) {
  assertCents(cents);
  return `$${(cents / 100).toFixed(2)}`;
}
