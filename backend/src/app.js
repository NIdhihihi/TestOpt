import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import router from "./routes/index.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((origin) => origin.trim());
app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Welcome to TestOpt API!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "TestOpt backend is running",
  });
});

app.use("/api", router);

export default app;
