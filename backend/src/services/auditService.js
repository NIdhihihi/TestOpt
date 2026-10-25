import { randomUUID } from "node:crypto";
import pool from "../db/connection.js";

export async function recordAuditEvent({ organizationId, userId, eventType, resourceType, resourceId, details = {} }) {
  await pool.query(
    "INSERT INTO audit_events (event_id, organization_id, user_id, event_type, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [`AUD_${randomUUID()}`, organizationId, userId, eventType, resourceType, resourceId, JSON.stringify(details)],
  );
}
