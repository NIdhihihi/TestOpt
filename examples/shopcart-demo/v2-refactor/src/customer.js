export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Email is required.');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email.');
  return email;
}
export function greeting(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Name is required.');
  return `Welcome, ${name.trim()}!`;
}
