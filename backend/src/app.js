import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import router from "./routes/index.js";
import { getAllowedOrigins } from "./services/sessionService.js";

const app = express();

function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || getAllowedOrigins().includes(origin)) {
        return callback(null, true);
      }
      return callback(Object.assign(new Error("Origin not allowed by CORS."), { status: 403 }));
    },
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "8mb", inflate: false }));

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

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  return res.status(status).json({
    success: false,
    message:
      error.type === "entity.too.large"
        ? "Upload exceeds the 8 MB request limit."
        : error.status === 403
          ? error.message
          : status < 500
            ? "Invalid or unsupported request body."
            : "The request could not be completed.",
  });
});

export default app;
