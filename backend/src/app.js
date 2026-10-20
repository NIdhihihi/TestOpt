import express from "express";
import cors from "cors";
import router from "./routes/index.js";

const app = express();

app.use(cors());
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
