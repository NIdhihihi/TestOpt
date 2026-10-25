import pool from "../db/connection.js";

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

export async function requireOrganizationRole(userId, organizationId, allowedRoles = ["OWNER", "ADMIN"]) {
  const [memberships] = await pool.query(
    "SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ?",
    [organizationId, userId],
  );
  if (!memberships[0] || !allowedRoles.includes(memberships[0].role)) throw forbidden("You do not have permission to manage this organization.");
  return memberships[0].role;
}

export async function requireProjectRole(userId, projectId, allowedRoles = ["OWNER", "ADMIN", "TEST_MANAGER", "DEVELOPER"]) {
  const [memberships] = await pool.query(
    "SELECT om.role, p.organization_id AS organizationId FROM projects p JOIN organization_members om ON om.organization_id = p.organization_id WHERE p.project_id = ? AND om.user_id = ?",
    [projectId, userId],
  );
  if (!memberships[0] || !allowedRoles.includes(memberships[0].role)) throw forbidden("You do not have permission to access this project.");
  return memberships[0];
}
