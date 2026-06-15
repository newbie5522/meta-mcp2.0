import { execSync } from "child_process";

function main() {
  console.log("=== Launching Python SQLite version check ===");
  try {
    const out = execSync("python3 src/server/check-sqlite-version.py", { encoding: "utf-8" });
    console.log(out);
  } catch (err: any) {
    console.error("Subprocess execution failed:", err.message || err);
  }
}

main();
