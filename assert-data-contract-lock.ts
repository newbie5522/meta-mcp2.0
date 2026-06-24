import fs from "fs";
import path from "path";

function getFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== "node_modules" && file !== "dist" && file !== ".git") {
        results = results.concat(getFiles(filePath));
      }
    } else {
      if (/\.(ts|tsx|js|jsx)$/.test(file)) {
        results.push(filePath);
      }
    }
  });
  return results;
}

const files = getFiles("./src");
let failed = false;

// Rule 5: src/shared/data-contract.ts must exist and not be empty
const contractPath = "./src/shared/data-contract.ts";
if (!fs.existsSync(contractPath)) {
  console.error("❌ Rule 5 failed: src/shared/data-contract.ts does not exist.");
  failed = true;
} else {
  const content = fs.readFileSync(contractPath, "utf-8");
  if (!content.trim()) {
    console.error("❌ Rule 5 failed: src/shared/data-contract.ts is empty.");
    failed = true;
  } else {
    console.log("✅ Rule 5 passed: src/shared/data-contract.ts exists and is populated.");
  }
}

// Rules 2, 3, 4: Scan files for forbidden queries and endpoint calls
for (const file of files) {
  const code = fs.readFileSync(file, "utf-8");
  const lines = code.split("\n");

  lines.forEach((line, idx) => {
    // Rule 2: No active prisma.adInsight query
    if (line.includes("prisma.adInsight.find") || line.includes("prisma.adInsight.upsert") || line.includes("prisma.adInsight.delete") || line.includes("prisma.adInsight.update")) {
      // Allow decommissioned explanations or comments
      if (!line.trim().startsWith("//") && !line.trim().startsWith("/*") && !line.includes("DECOMMISSIONED") && !line.includes("decommissioned")) {
        console.error(`❌ Rule 2 failed in ${file}:${idx + 1} - Found active prisma.adInsight query: "${line.trim()}"`);
        failed = true;
      }
    }

    // Rule 3: No active prisma.dailySummary query
    if (line.includes("prisma.dailySummary.find") || line.includes("prisma.dailySummary.upsert") || line.includes("prisma.dailySummary.delete") || line.includes("prisma.dailySummary.update")) {
      if (!line.trim().startsWith("//") && !line.trim().startsWith("/*") && !line.includes("DECOMMISSIONED") && !line.includes("decommissioned")) {
        console.error(`❌ Rule 3 failed in ${file}:${idx + 1} - Found active prisma.dailySummary query: "${line.trim()}"`);
        failed = true;
      }
    }

    // Rule 4: No unallowed all-dashboard-summary reference
    if (line.includes("all-dashboard-summary")) {
      const normalizedPath = file.replace(/\\/g, "/");
      const isAllowedFile = normalizedPath.includes("Dashboard.tsx") || normalizedPath.includes("stores.routes.ts") || normalizedPath.includes("assert-data-contract-lock.ts");
      if (!isAllowedFile) {
        console.error(`❌ Rule 4 failed in ${file}:${idx + 1} - Found unallowed all-dashboard-summary reference: "${line.trim()}"`);
        failed = true;
      }
    }
  });
}

if (failed) {
  console.error("❌ Static rule contract lock assertions FAILED!");
  process.exit(1);
} else {
  console.log("✅ All static rule contract lock assertions PASSED successfully!");
  process.exit(0);
}
