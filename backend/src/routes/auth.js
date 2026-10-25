import { Router } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "../db/connection.js";
import { createAccessToken, requireAuth } from "../middleware/auth.js";
import { requireOrganizationRole } from "../middleware/authorization.js";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ORG_ROLES = new Set(["OWNER", "ADMIN", "TEST_MANAGER", "DEVELOPER"]);

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) throw new Error(`${name} is required and must be at most ${maxLength} characters.`);
  return value.trim();
}

router.post("/register", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const name = requiredText(req.body.name, "name", 100);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const organizationName = requiredText(req.body.organizationName, "organizationName", 150);
    if (!emailPattern.test(email)) throw new Error("email must be valid.");
    if (typeof req.body.password !== "string" || req.body.password.length < 12) throw new Error("password must be at least 12 characters.");
    const userId = `USR_${randomUUID()}`;
    const organizationId = `ORG_${randomUUID()}`;
    const passwordHash = await bcrypt.hash(req.body.password, 12);
    await connection.beginTransaction();
    await connection.query("INSERT INTO users (user_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'DEVELOPER')", [userId, name, email, passwordHash]);
    await connection.query("INSERT INTO organizations (organization_id, organization_name) VALUES (?, ?)", [organizationId, organizationName]);
    await connection.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'OWNER')", [organizationId, userId]);
    await connection.commit();
    const user = { userId, name, email };
    return res.status(201).json({ success: true, accessToken: createAccessToken(user), user, organization: { organizationId, organizationName, role: "OWNER" } });
  } catch (error) {
    await connection.rollback();
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 400).json({ success: false, message: error.code === "ER_DUP_ENTRY" ? "An account already exists for this email." : error.message });
  } finally { connection.release(); }
});

router.post("/login", async (req, res) => {
  try {
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const [users] = await pool.query("SELECT user_id AS userId, name, email, password_hash AS passwordHash FROM users WHERE email = ?", [email]);
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    const [organizations] = await pool.query("SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name", [user.userId]);
    return res.json({ success: true, accessToken: createAccessToken(user), user: { userId: user.userId, name: user.name, email: user.email }, organizations });
  } catch (error) { return res.status(400).json({ success: false, message: error.message }); }
});

router.get("/me", requireAuth, async (req, res) => {
  const [users] = await pool.query("SELECT user_id AS userId, name, email FROM users WHERE user_id = ?", [req.auth.sub]);
  if (!users[0]) return res.status(404).json({ success: false, message: "User was not found." });
  const [organizations] = await pool.query("SELECT o.organization_id AS organizationId, o.organization_name AS organizationName, om.role FROM organization_members om JOIN organizations o ON o.organization_id = om.organization_id WHERE om.user_id = ? ORDER BY o.organization_name", [req.auth.sub]);
  return res.json({ success: true, user: users[0], organizations });
});

router.get("/organizations/:organizationId/members", requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const [members] = await pool.query(
      `SELECT u.user_id AS userId, u.name, u.email, om.role, om.created_at AS joinedAt
       FROM organization_members om
       JOIN users u ON u.user_id = om.user_id
       WHERE om.organization_id = ?
       ORDER BY u.name`,
      [organizationId]
    );
    return res.json({ success: true, members });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

router.post("/organizations/:organizationId/members", requireAuth, async (req, res) => {
  try {
    const { organizationId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const email = requiredText(req.body.email, "email", 150).toLowerCase();
    const role = (req.body.role || "DEVELOPER").toUpperCase();
    if (!VALID_ORG_ROLES.has(role)) throw new Error("Invalid organization role.");

    const [users] = await pool.query("SELECT user_id AS userId FROM users WHERE email = ?", [email]);
    if (!users[0]) return res.status(404).json({ success: false, message: "User with this email does not exist." });

    await pool.query(
      "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)",
      [organizationId, users[0].userId, role]
    );
    return res.status(201).json({ success: true, member: { userId: users[0].userId, email, role } });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

router.put("/organizations/:organizationId/members/:userId", requireAuth, async (req, res) => {
  try {
    const { organizationId, userId } = req.params;
    await requireOrganizationRole(req.auth.sub, organizationId, ["OWNER", "ADMIN"]);
    const role = requiredText(req.body.role, "role", 20).toUpperCase();
    if (!VALID_ORG_ROLES.has(role)) throw new Error("Invalid organization role.");

    const [result] = await pool.query(
      "UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?",
      [role, organizationId, userId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Member not found in organization." });

    return res.json({ success: true, member: { userId, role } });
  } catch (error) {
    return res.status(error.statusCode ?? 400).json({ success: false, message: error.message });
  }
});

export default router;
