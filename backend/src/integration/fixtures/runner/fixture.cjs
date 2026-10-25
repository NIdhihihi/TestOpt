const mode = process.argv[2];
console.log(`Smoke runner: ${mode}`);
if (mode === "hang") setInterval(() => {}, 1000);
else setTimeout(() => process.exit(mode === "fail" ? 1 : 0), 1500);
