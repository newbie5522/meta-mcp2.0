import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanTargets = ["src", "README.md", ".env.example", "docker-compose.yml"];

const checks = [
  {
    name: "No Meta write client calls",
    pattern: /metaApiClient\.(post|postForm|postMultipart|delete)\s*\(/,
  },
  {
    name: "No write-like MCP tool names",
    pattern: /ads_(create|update|delete|activate|pause|upload)|create_campaign|update_campaign|delete_campaign|pause_campaign|activate_campaign/i,
  },
  {
    name: "No wildcard CORS in deployment files",
    pattern: /CORS_ALLOWED_ORIGINS\s*=\s*\*/,
  },
  {
    name: "No production read-only disable flag",
    pattern: /READ_ONLY_MODE\s*=\s*false/i,
  },
  {
    name: "No obvious hard-coded Meta token",
    pattern: /EA[A-Za-z0-9]{80,}/,
  },
];

const requiredToolNames = [
  "ads_readonly_get_ad_accounts",
  "ads_readonly_get_account_info",
  "ads_readonly_get_campaigns",
  "ads_readonly_get_ad_sets",
  "ads_readonly_get_ads",
  "ads_readonly_get_creatives",
  "ads_readonly_get_insights",
];

function filesFor(target) {
  const absolute = join(root, target);
  const stat = statSync(absolute);
  if (stat.isFile()) return [absolute];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry === "dist") continue;
    files.push(...filesFor(join(target, entry)));
  }
  return files;
}

const files = scanTargets.flatMap(filesFor);
const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const check of checks) {
    if (check.pattern.test(text)) {
      failures.push(`${check.name}: ${relative(root, file)}`);
    }
  }
}

const toolsIndex = readFileSync(join(root, "src/tools/index.ts"), "utf8");
for (const toolName of requiredToolNames) {
  if (!toolsIndex.includes(toolName)) {
    failures.push(`Missing required read-only tool: ${toolName}`);
  }
}

if (failures.length > 0) {
  console.error("Read-only verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Read-only verification passed.");
