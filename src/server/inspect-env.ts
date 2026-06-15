import fs from "fs";
import path from "path";

function main() {
  console.log("=== Checking environment variables in Node ===");
  const keys = Object.keys(process.env).sort();
  for (const key of keys) {
    if (key.includes("SECRET") || key.includes("KEY") || key.includes("TOKEN") || key.includes("PASS")) {
      console.log(`${key}: [SECRET REDACTED]`);
    } else {
      console.log(`${key}: ${process.env[key]}`);
    }
  }

  const envPath = path.resolve(".env");
  if (fs.existsSync(envPath)) {
    console.log("\n.env file exists!");
    const content = fs.readFileSync(envPath, "utf-8");
    console.log("=== .env File Content ===");
    console.log(content);
  } else {
    console.log("\n.env file does NOT exist!");
  }
}

main();
