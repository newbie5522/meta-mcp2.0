import fs from "fs";
import path from "path";
import prisma from "../../db/index.js";

async function main() {
  console.log("==========================================================================");
  console.log("            MIA-TZ-001 FINAL: AUDIT CLEANUP CANDIDATES REPORT             ");
  console.log("==========================================================================");

  // 1. Scan codebase for old/obsolete synchronization functions
  console.log("\n[1] 正在扫描旧同步方法及遗留引用的代码行...");
  const oldFunctions = [
    "syncShoplineStoreData",
    "syncShopifyStoreData",
    "syncShoplazzaStoreData",
    "fetchShoplineOrdersDirect"
  ];

  const searchDir = (dir: string, fileList: string[] = []) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file === "node_modules" || file === "dist" || file === ".git" || file === "repo") continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        searchDir(filePath, fileList);
      } else if (stat.isFile() && (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".tsx"))) {
        // Skip this audit script itself to avoid false positives
        if (file !== "audit-cleanup-candidates.ts") {
          fileList.push(filePath);
        }
      }
    }
    return fileList;
  };

  const allSourceFiles = searchDir(process.cwd());
  const occurrences: Record<string, string[]> = {};
  for (const fn of oldFunctions) {
    occurrences[fn] = [];
  }

  for (const file of allSourceFiles) {
    try {
      const content = fs.readFileSync(file, "utf8");
      for (const fn of oldFunctions) {
        if (content.includes(fn)) {
          const relative = path.relative(process.cwd(), file);
          occurrences[fn].push(relative);
        }
      }
    } catch (err) {
      // Ignore read errors
    }
  }

  for (const fn of oldFunctions) {
    if (occurrences[fn].length > 0) {
      console.log(`⚠️  旧函数 [${fn}] 在以下文件中仍被引用:`);
      occurrences[fn].forEach(f => console.log(`   - ${f}`));
    } else {
      console.log(`✅  旧函数 [${fn}] 未在代码库中发现有效引用。`);
    }
  }

  // 2. Identify stale / old / backup files
  console.log("\n[2] 正在扫描遗留诊断、备份与临时测试文件...");
  const searchRootForLegacyFiles = () => {
    const rootFiles = fs.readdirSync(process.cwd());
    const candidates: string[] = [];
    for (const file of rootFiles) {
      const fullPath = path.join(process.cwd(), file);
      if (fs.statSync(fullPath).isFile()) {
        const lower = file.toLowerCase();
        if (
          lower.startsWith("diagnostic_") ||
          lower.startsWith("diagnostic-") ||
          lower.startsWith("test_") ||
          lower.startsWith("test-") ||
          lower.startsWith("nocheck") ||
          lower.endsWith(".old") ||
          lower.endsWith(".bak") ||
          lower.endsWith(".tmp") ||
          lower === "copy.ts"
        ) {
          candidates.push(file);
        }
      }
    }
    return candidates;
  };

  const legacyFiles = searchRootForLegacyFiles();
  if (legacyFiles.length > 0) {
    console.log("⚠️  发现可能需要清理的根目录遗留文件列表:");
    legacyFiles.forEach(f => console.log(`   - ${f}`));
  } else {
    console.log("✅  未在根目录下发现多余的临时或遗留文件。");
  }

  // 3. package.json scripts analysis
  console.log("\n[3] 正在分析 package.json 脚本以检测是否存在冗余的脚本配置...");
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const scripts = pkgJson.scripts || {};
    const deprecatedKeywords = ["test", "seed", "sandbox", "fake", "demo", "mock"];
    const deprecatedScripts: string[] = [];
    Object.keys(scripts).forEach(name => {
      const cmd = scripts[name];
      for (const kw of deprecatedKeywords) {
        if (name.includes(kw) || cmd.includes(kw)) {
          deprecatedScripts.push(`${name}: "${cmd}"`);
          break;
        }
      }
    });

    if (deprecatedScripts.length > 0) {
      console.log("⚠️  以下 package.json 脚本包含测试/演示等冗余描述，建议重构或删除:");
      deprecatedScripts.forEach(s => console.log(`   - ${s}`));
    } else {
      console.log("✅  package.json 脚本未包含明显废弃的测试/模拟类型。");
    }
  } catch (err: any) {
    console.error("❌ 无法读取 package.json 文件", err.message);
  }

  // 4. Duplicate Order Entry Checks
  console.log("\n[4] 正在检测 Order 订单表是否存在同一店铺+同订单ID+同本地时间多行重复记录 (基于 storeId + orderId + store_local_date)...");
  try {
    const duplicateGroups = await prisma.order.groupBy({
      by: ["storeId", "orderId", "store_local_date"],
      _count: {
        id: true
      },
      having: {
        id: {
          _count: {
            gt: 1
          }
        }
      }
    });

    if (duplicateGroups.length > 0) {
      console.log(`⚠️  在该 SQLite 数据库中发现 ${duplicateGroups.length} 组订单重复记录候选清单:`);
      for (const group of duplicateGroups) {
        const matchingOrders = await prisma.order.findMany({
          where: {
            storeId: group.storeId,
            orderId: group.orderId,
            store_local_date: group.store_local_date
          }
        });
        const ids = matchingOrders.map((o: any) => o.id);
        const rows = group._count.id;
        console.log(`   - 店铺ID: ${group.storeId} | 订单ID: ${group.orderId} | 日期: ${group.store_local_date}`);
        console.log(`     重复行数: ${rows} | 记录全局标识 (Prisma UUIDs): ${ids.join(", ")}`);
        
        // Output safe cleanup recommendation as per instructions:
        const cleanSql = `DELETE FROM "Order" WHERE "storeId" = ${group.storeId} AND "orderId" = '${group.orderId}' AND "id" NOT IN (SELECT MIN("id") FROM "Order" WHERE "storeId" = ${group.storeId} AND "orderId" = '${group.orderId}');`;
        console.log(`     💡 建议清理 SQL 口径: ${cleanSql}`);
      }
    } else {
      console.log("✅  数据库订单表中不存在任何重复 (storeId + orderId + store_local_date) 的记录行。");
    }
  } catch (err: any) {
    console.error("❌ 订单重复行归集检索失败:", err.message);
  }

  // 5. Query Failed Sync logs
  console.log("\n[5] 最近 10 次同步运行失败或异常的任务日志汇总:");
  try {
    const failedLogs = await prisma.syncLog.findMany({
      where: {
        status: { in: ["failed", "ERROR", "error"] }
      },
      orderBy: {
        startedAt: "desc"
      },
      take: 10
    });

    if (failedLogs.length > 0) {
      failedLogs.forEach((log: any) => {
        console.log(`   - 任务: ${log.type || log.taskType} | 店铺: ${log.storeId || "无"} | 失败时点: ${log.startedAt.toISOString()} | 异常信息: ${log.errorMessage || log.error || "未捕获错误"}`);
      });
    } else {
      console.log("✅  最近没有任何同步失败的日志记录，系统一切正常！");
    }
  } catch (err: any) {
    console.error("❌ 读取 SyncLog 失败:", err.message);
  }

  // 6. Sandbox / Fixture / Demo Data validation
  console.log("\n[6] 正在分析数据层中是否存在 sandbox/fixture 虚拟脏数据...");
  try {
    const sandboxStores = await prisma.store.findMany({
      where: {
        OR: [
          { mode: "sandbox" },
          { name: { contains: "sandbox" } },
          { name: { contains: "demo" } }
        ]
      }
    });

    if (sandboxStores.length > 0) {
      console.log(`⚠️  数据库中有 ${sandboxStores.length} 个沙箱或预置测试店面:`);
      sandboxStores.forEach((s: any) => {
        console.log(`   - 店面名称: "${s.name}" (ID: ${s.id}, 平台: ${s.platform}, Mode: ${s.mode})`);
      });
      console.log("     💡 *注意*: 基准店铺 'baslayer' (Shopline) 含有真实订单数，不得删除；这里仅作汇总清单展示。");
    } else {
      console.log("✅  未发现包含 sandbox/demo 命名的特异性虚拟店面。");
    }
  } catch (err: any) {
    console.error("❌ 扫描沙箱测试店铺失败:", err.message);
  }

  console.log("\n==========================================================================");
  console.log("            MIA-TZ-001 FINAL: AUDIT CLEAN-UP INVENTORY COMPLETED          ");
  console.log("==========================================================================");
}

main().catch(err => {
  console.error("Audit runner crashed unexpectedly:", err);
});
