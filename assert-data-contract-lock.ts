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

const allFiles = getFiles("./src");
// Filter to scan only: src/server/routes, src/server/services, src/components
const files = allFiles.filter(file => {
  const norm = file.replace(/\\/g, "/");
  return (
    norm.includes("src/server/routes/") ||
    norm.includes("src/server/services/") ||
    norm.includes("src/components/")
  );
});

let failed = false;

// Helper to clean comments
function isLineCommented(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

console.log("🔍 Running Static Rule Contract Lock Assertions...\n");

// 1. Check data-contract.ts exists and is populated
const contractPath = "./src/shared/data-contract.ts";
if (!fs.existsSync(contractPath)) {
  console.error("❌ Rule Check failed: src/shared/data-contract.ts does not exist.");
  failed = true;
} else {
  const content = fs.readFileSync(contractPath, "utf-8");
  if (!content.trim()) {
    console.error("❌ Rule Check failed: src/shared/data-contract.ts is empty.");
    failed = true;
  } else {
    console.log("✅ Rule Check passed: src/shared/data-contract.ts exists and is populated.");
  }
}

// 1B. Check menu-data-contract.ts exists and is populated
const menuContractPath = "./src/shared/menu-data-contract.ts";
if (!fs.existsSync(menuContractPath)) {
  console.error("❌ Rule Check failed: src/shared/menu-data-contract.ts does not exist.");
  failed = true;
} else {
  const content = fs.readFileSync(menuContractPath, "utf-8");
  if (!content.includes("MENU_DATA_CONTRACT")) {
    console.error("❌ Rule Check failed: src/shared/menu-data-contract.ts does not export MENU_DATA_CONTRACT.");
    failed = true;
  } else {
    console.log("✅ Rule Check passed: src/shared/menu-data-contract.ts exists and exports MENU_DATA_CONTRACT.");
  }
}

// 1C. Check data-center-audit.service.ts computes and returns menuChain
const auditServicePath = "./src/server/services/data-center-audit.service.ts";
if (!fs.existsSync(auditServicePath)) {
  console.error("❌ Rule Check failed: src/server/services/data-center-audit.service.ts does not exist.");
  failed = true;
} else {
  const content = fs.readFileSync(auditServicePath, "utf-8");
  if (!content.includes("menuChain")) {
    console.error("❌ Rule Check failed: data-center-audit.service.ts does not compute or return 'menuChain'.");
    failed = true;
  } else {
    console.log("✅ Rule Check passed: data-center-audit.service.ts computes and returns 'menuChain'.");
  }
}

// 2. Scan files for forbidden queries, decommissioned API calls, and config leaks
for (const file of files) {
  const code = fs.readFileSync(file, "utf-8");
  const lines = code.split("\n");
  const normalizedFile = file.replace(/\\/g, "/");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // A. Prohibit any active prisma.adInsight query
    if (line.includes("prisma.adInsight.")) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Query Check failed in ${file}:${lineNum} - Found active prisma.adInsight reference: "${line.trim()}"`);
        failed = true;
      }
    }

    // B. Prohibit any active prisma.dailySummary query
    if (line.includes("prisma.dailySummary.")) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Query Check failed in ${file}:${lineNum} - Found active prisma.dailySummary reference: "${line.trim()}"`);
        failed = true;
      }
    }

    // C. Prohibit any active prisma.creativePerformanceDaily query
    if (line.includes("prisma.creativePerformanceDaily.")) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Query Check failed in ${file}:${lineNum} - Found active prisma.creativePerformanceDaily reference: "${line.trim()}"`);
        failed = true;
      }
    }
    
    // D. Prohibit all-dashboard-summary anywhere in active src code (no route, axios, or endpoint)
    if (line.includes("all-dashboard-summary")) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Endpoint Check failed in ${file}:${lineNum} - Found active 'all-dashboard-summary': "${line.trim()}"`);
        failed = true;
      }
    }

    // E. Prohibit dashboard-summary as route pattern, axios path, or API registration in src code
    // We allow component classnames/id like ai-dashboard-summary-card
    if (line.includes("dashboard-summary") && !line.includes("ai-dashboard-summary") && !line.includes("ai_dashboard_summary")) {
      if (!isLineCommented(line)) {
        // Fail if used as an API URL, router endpoint, or request path
        if (line.includes("axios.") || line.includes("get(") || line.includes("post(") || line.includes("api/stores") || line.includes("router.")) {
          console.error(`❌ Prohibited Endpoint Check failed in ${file}:${lineNum} - Found active 'dashboard-summary' request/routing: "${line.trim()}"`);
          failed = true;
        }
      }
    }

    // F. Prohibit /api/insights in active API paths
    if (line.includes("/api/insights")) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Endpoint Check failed in ${file}:${lineNum} - Found active '/api/insights' reference: "${line.trim()}"`);
        failed = true;
      }
    }

    // G. Prohibit frontend writing meta_token
    if (normalizedFile.includes("src/components") && line.includes(`key: "meta_token"`)) {
      if (!isLineCommented(line)) {
        console.error(`❌ Prohibited Frontend Token Write Check failed in ${file}:${lineNum} - Frontend must not write 'meta_token': "${line.trim()}"`);
        failed = true;
      }
    }

    // H. Prohibit legacy getMetaToken findFirst call searching META_ACCESS_TOKEN and meta_token together
    if (normalizedFile.includes("utils.ts") && line.includes("findFirst") && line.includes("META_ACCESS_TOKEN") && line.includes("meta_token")) {
      console.error(`❌ Prohibited getMetaToken Pattern Check failed in ${file}:${lineNum} - getMetaToken must not use findFirst with list mapping: "${line.trim()}"`);
      failed = true;
    }
  });
}

// 2B. Check Prisma schema does not expose retired models through Prisma Client
const prismaSchemaPath = "./prisma/schema.prisma";
if (fs.existsSync(prismaSchemaPath)) {
  const schema = fs.readFileSync(prismaSchemaPath, "utf-8");

  const retiredModels = [
    "AdInsight",
    "CreativePerformanceDaily",
    "DailySummary"
  ];

  for (const modelName of retiredModels) {
    const pattern = new RegExp(`model\\s+${modelName}\\s+\\{`);
    if (pattern.test(schema)) {
      console.error(`❌ Prisma Model Retirement Check failed: schema.prisma still exposes retired model "${modelName}".`);
      failed = true;
    }
  }
}

// 3. Check stores.routes.ts strictly to make sure it doesn't self-compute or read forbidden tables
const storesRoutesPath = "./src/server/routes/stores.routes.ts";
if (fs.existsSync(storesRoutesPath)) {
  const code = fs.readFileSync(storesRoutesPath, "utf-8");
  if (code.includes("/all-dashboard-summary") || code.includes("/:id/dashboard-summary")) {
    console.error("❌ Stores routes Check failed: stores.routes.ts still registers summary endpoints.");
    failed = true;
  }
}

if (failed) {
  console.error("\n❌ Static rule contract lock assertions FAILED!");
  process.exit(1);
} else {
  console.log("\n✅ All static rule contract lock assertions PASSED successfully!");
  process.exit(0);
}
