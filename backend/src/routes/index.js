import { Router } from "express";
import pool from "../db/connection.js";
import executionRouter from "../execution/routes.js";
import catalogRouter from "./catalog.js";
import authRouter from "./auth.js";
import optimizationRouter from "./optimization.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({
    message: "TestOpt API",
    modules: ["foundation", "optimization", "execution", "analytics"],
  });
});

router.get("/db-test", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT module_id, module_name, criticality FROM modules ORDER BY module_id",
    );

    res.json({
      success: true,
      message: "MySQL connection successful!",
      modules: rows,
    });
  } catch (error) {
    console.error("Database test failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Database connection failed. Check backend configuration.",
    });
  }
});

router.use("/optimization", optimizationRouter);
router.use("/execution", executionRouter);
router.use("/catalog", catalogRouter);
router.use("/auth", authRouter);

export default router;
