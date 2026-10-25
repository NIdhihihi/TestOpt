export function redisConnectionOptions(value = process.env.REDIS_URL || "redis://127.0.0.1:6379") {
  const url = new URL(value);
  if (!["redis:", "rediss:"].includes(url.protocol)) throw new Error("REDIS_URL must use redis:// or rediss://.");
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("Redis database must be a non-negative integer.");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
