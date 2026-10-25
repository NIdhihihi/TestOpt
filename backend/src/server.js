import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`TestOpt backend running at http://localhost:${PORT}`);
});
