import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TIMEZONE = "America/Los_Angeles";

function laDate(offsetDays = 0) {
  const now = new Date();
  const la = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  la.setDate(la.getDate() + offsetDays);
  return la.toISOString().slice(0, 10);
}

const today = laDate(0);
const yesterday = laDate(-1);

const ranges = {
  today: [today, today],
  yesterday: [yesterday, yesterday],
  past_7: [laDate(-6), today],
  past_14: [laDate(-13), today],
  past_30: [laDate(-29), today]
};

function num(value) {
  return Number(value || 0);
}

async function metaFactRows(rangeName, startDate, endDate) {
  const rows = await prisma.factMetaPerformance.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true, spend: true, impressions: true, clicks: true, purchases: true }
  });
  return matrixRow("FactMetaPerformance", rangeName, rows);
}

async function audienceRows(rangeName, startDate, endDate) {
  const rows = await prisma.factAudienceBreakdown.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { date: true, spend: true, impressions: true, clicks: true, purchases: true }
  });
  return matrixRow("FactAudienceBreakdown", rangeName, rows);
}

async function syncLogRows(rangeName, startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  const rows = await prisma.syncLog.findMany({
    where: { startedAt: { gte: start, lte: end } },
    select: { startedAt: true, recordsFetched: true, recordsSaved: true }
  });

  return {
    table: "SyncLog",
    range: rangeName,
    rows: rows.length,
    minDate: rows.length ? rows.map(row => row.startedAt.toISOString().slice(0, 10)).sort()[0] : "",
    maxDate: rows.length ? rows.map(row => row.startedAt.toISOString().slice(0, 10)).sort().slice(-1)[0] : "",
    spend: "",
    impressions: rows.reduce((sum, row) => sum + num(row.recordsFetched), 0),
    clicks: rows.reduce((sum, row) => sum + num(row.recordsSaved), 0),
    purchases: ""
  };
}

function matrixRow(table, rangeName, rows) {
  const dates = rows.map(row => row.date).filter(Boolean).sort();
  return {
    table,
    range: rangeName,
    rows: rows.length,
    minDate: dates[0] || "",
    maxDate: dates.slice(-1)[0] || "",
    spend: rows.reduce((sum, row) => sum + num(row.spend), 0),
    impressions: rows.reduce((sum, row) => sum + num(row.impressions), 0),
    clicks: rows.reduce((sum, row) => sum + num(row.clicks), 0),
    purchases: rows.reduce((sum, row) => sum + num(row.purchases), 0)
  };
}

async function structureRows(table, modelName) {
  const model = prisma[modelName];
  if (!model?.count) {
    return {
      table,
      range: "all",
      rows: "MODEL_NOT_FOUND",
      minDate: "",
      maxDate: "",
      spend: "",
      impressions: "",
      clicks: "",
      purchases: ""
    };
  }
  return {
    table,
    range: "all",
    rows: await model.count(),
    minDate: "",
    maxDate: "",
    spend: "",
    impressions: "",
    clicks: "",
    purchases: ""
  };
}

function printTable(rows) {
  console.log("| table | range | rows | minDate | maxDate | spend | impressions | clicks | purchases |");
  console.log("|---|---|---:|---|---|---:|---:|---:|---:|");
  for (const row of rows) {
    console.log(
      `| ${row.table} | ${row.range} | ${row.rows} | ${row.minDate} | ${row.maxDate} | ${row.spend === "" ? "" : Number(row.spend || 0).toFixed(2)} | ${row.impressions === "" ? "" : Math.round(Number(row.impressions || 0))} | ${row.clicks === "" ? "" : Math.round(Number(row.clicks || 0))} | ${row.purchases === "" ? "" : Math.round(Number(row.purchases || 0))} |`
    );
  }
}

async function main() {
  const rows = [];
  for (const [rangeName, [startDate, endDate]] of Object.entries(ranges)) {
    rows.push(await metaFactRows(rangeName, startDate, endDate));
    rows.push(await audienceRows(rangeName, startDate, endDate));
    rows.push(await syncLogRows(rangeName, startDate, endDate));
  }

  rows.push(await structureRows("AdAccount", "adAccount"));
  rows.push(await structureRows("Campaign", "campaign"));
  rows.push(await structureRows("AdSet", "adSet"));
  rows.push(await structureRows("Ad", "ad"));
  rows.push(await structureRows("AdCreative", "adCreative"));

  printTable(rows);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
