import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STALE_MINUTES = Number(process.env.RCA_STALE_MINUTES || 30);

function parseMetadata(log) {
  if (!log?.metadata) return {};
  if (typeof log.metadata === "object") return log.metadata;
  try {
    return JSON.parse(String(log.metadata));
  } catch {
    return {};
  }
}

function durationMinutes(log) {
  const end = log.finishedAt ? new Date(log.finishedAt).getTime() : Date.now();
  const start = log.startedAt ? new Date(log.startedAt).getTime() : end;
  return Math.round(((end - start) / 60000) * 10) / 10;
}

function shortError(log) {
  return String(log.errorMessage || log.error || "").replace(/\s+/g, " ").slice(0, 180);
}

function printRecentLogs(logs) {
  console.log("| id | taskType | taskChainId | status | startedAt | completedAt | durationMin | recordsFetched | recordsSaved | error |");
  console.log("|---|---|---|---|---|---|---:|---:|---:|---|");
  for (const log of logs) {
    console.log(
      `| ${log.id} | ${log.taskType || log.type || ""} | ${log.taskChainId || ""} | ${log.status} | ${log.startedAt?.toISOString?.() || ""} | ${log.finishedAt?.toISOString?.() || ""} | ${durationMinutes(log)} | ${log.recordsFetched || 0} | ${log.recordsSaved || 0} | ${shortError(log)} |`
    );
  }
}

function printDistribution(title, rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || "";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  console.log(`\n${title}`);
  console.log("| value | count |");
  console.log("|---|---:|");
  for (const [value, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${value} | ${count} |`);
  }
}

async function main() {
  const columns = `
    id,
    taskType,
    type,
    taskChainId,
    status,
    startedAt,
    finishedAt,
    recordsFetched,
    recordsSaved,
    error,
    errorMessage,
    metadata
  `;
  const [running, recent, failed, allRecent] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT ${columns} FROM SyncLog WHERE status = 'running' ORDER BY startedAt DESC`),
    prisma.$queryRawUnsafe(`SELECT ${columns} FROM SyncLog ORDER BY startedAt DESC LIMIT 20`),
    prisma.$queryRawUnsafe(`SELECT ${columns} FROM SyncLog WHERE status = 'failed' ORDER BY startedAt DESC LIMIT 20`),
    prisma.$queryRawUnsafe(`SELECT ${columns} FROM SyncLog ORDER BY startedAt DESC LIMIT 200`)
  ]);

  const staleCutoff = Date.now() - STALE_MINUTES * 60000;
  const staleRunning = running.filter(log => new Date(log.startedAt).getTime() < staleCutoff);

  console.log(`# R5-RCA Sync Lock Audit`);
  console.log(`runningTasks=${running.length}`);
  console.log(`staleRunningTasksOver${STALE_MINUTES}Min=${staleRunning.length}`);

  console.log("\n## Running Tasks");
  printRecentLogs(running);

  console.log("\n## Stale Running Tasks");
  printRecentLogs(staleRunning);

  console.log("\n## Recent Failed Tasks");
  printRecentLogs(failed);

  console.log("\n## Recent Tasks");
  printRecentLogs(recent);

  printDistribution("\n## Task Type Distribution (last 200)", allRecent, "taskType");
  printDistribution("\n## Task Chain Distribution (last 200)", allRecent, "taskChainId");

  console.log("\n## Failed Metadata Snapshot");
  console.log("| id | taskType | metadata.status | metadata.reason | metadata.failedAccounts |");
  console.log("|---|---|---|---|---:|");
  for (const log of failed.slice(0, 10)) {
    const metadata = parseMetadata(log);
    const failedAccounts = Array.isArray(metadata.failedAccounts) ? metadata.failedAccounts.length : 0;
    console.log(`| ${log.id} | ${log.taskType || ""} | ${metadata.status || ""} | ${metadata.reason || ""} | ${failedAccounts} |`);
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
