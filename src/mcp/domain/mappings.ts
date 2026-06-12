// @ts-nocheck
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { parseFirstXlsxSheet } from "../utils/xlsx.js";

export const mappingImportRowSchema = z.object({
  store_name: z.string().min(1),
  platform: z.enum(["shopline", "shoplazza", "shopify"]),
  domain: z.string().min(1).transform((value) => value.trim().toLowerCase()),
  meta_account_id: z.string().min(1),
  meta_account_name: z.string().optional().default(""),
});

export type MappingImportRow = z.infer<typeof mappingImportRowSchema>;

export interface MappingImportIssue {
  row: number;
  code: "invalid_row" | "store_not_found" | "ad_account_not_found" | "ad_account_name_mismatch";
  message: string;
  recommendation?: string;
}

export interface MappingImportFileInput {
  fileName: string;
  contentBase64: string;
}

function normalizeMetaAccountId(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

export function parseMappingCsv(csv: string): Record<string, string>[] {
  return parseMappingDelimitedText(csv, ",");
}

export function parseMappingDelimitedText(text: string, delimiter: "," | "\t" = ","): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index++;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const [headerRow, ...dataRows] = rows.filter((row) => row.some((value) => value.trim()));
  if (!headerRow) return [];
  const headers = headerRow.map((header) => header.trim());
  return dataRows
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])));
}

export function parseMappingImportFile(input: MappingImportFileInput): Record<string, string>[] {
  const fileName = input.fileName.toLowerCase();
  const buffer = Buffer.from(input.contentBase64, "base64");
  if (buffer.length > 1_000_000) {
    throw new Error("Mapping import file is too large. Maximum size is 1 MB.");
  }
  if (fileName.endsWith(".xlsx")) {
    return rowsToObjects(parseFirstXlsxSheet(buffer));
  }
  const text = buffer.toString("utf8");
  if (fileName.endsWith(".tsv") || text.includes("\t")) {
    return parseMappingDelimitedText(text, "\t");
  }
  return parseMappingCsv(text);
}

export async function bindStoreToAdAccount(storeId: string, adAccountId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const adAccount = await prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });

  return prisma.storeAdAccountMap.upsert({
    where: { adAccountId: adAccount.id },
    update: { storeId: store.id },
    create: { storeId: store.id, adAccountId: adAccount.id },
  });
}

export async function bindStoreToAdAccounts(storeId: string, adAccountIds: string[]) {
  const uniqueIds = [...new Set(adAccountIds.filter(Boolean))];
  let saved = 0;
  for (const adAccountId of uniqueIds) {
    await bindStoreToAdAccount(storeId, adAccountId);
    saved++;
  }
  return { saved };
}

export async function validateMappingImport(csv: string): Promise<{
  validRows: MappingImportRow[];
  issues: MappingImportIssue[];
}> {
  const rawRows = parseMappingCsv(csv);
  return validateMappingRows(rawRows);
}

export async function validateMappingImportFile(input: MappingImportFileInput): Promise<{
  validRows: MappingImportRow[];
  issues: MappingImportIssue[];
}> {
  const rawRows = parseMappingImportFile(input);
  return validateMappingRows(rawRows);
}

async function validateMappingRows(rawRows: Record<string, string>[]): Promise<{
  validRows: MappingImportRow[];
  issues: MappingImportIssue[];
}> {
  const validRows: MappingImportRow[] = [];
  const issues: MappingImportIssue[] = [];

  for (const [index, raw] of rawRows.entries()) {
    const rowNumber = index + 2;
    const parsed = mappingImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({
        row: rowNumber,
        code: "invalid_row",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }

    const row = {
      ...parsed.data,
      meta_account_id: normalizeMetaAccountId(parsed.data.meta_account_id),
    };

    const store = await prisma.store.findFirst({
      where: {
        name: row.store_name,
        platform: row.platform,
        domain: row.domain,
      },
    });
    if (!store) {
      issues.push({
        row: rowNumber,
        code: "store_not_found",
        message: `Store not found: ${row.store_name} / ${row.platform} / ${row.domain}`,
      });
      continue;
    }

    const adAccount = await prisma.adAccount.findUnique({
      where: { metaAccountId: row.meta_account_id },
    });
    if (!adAccount) {
      const recommendation = await recommendAdAccount(row.meta_account_name);
      issues.push({
        row: rowNumber,
        code: "ad_account_not_found",
        message: `Ad account not found: ${row.meta_account_id}`,
        recommendation,
      });
      continue;
    }

    if (
      row.meta_account_name &&
      adAccount.name &&
      adAccount.name.trim().toLowerCase() !== row.meta_account_name.trim().toLowerCase()
    ) {
      issues.push({
        row: rowNumber,
        code: "ad_account_name_mismatch",
        message: `Account ID exists but name differs: import "${row.meta_account_name}", database "${adAccount.name}"`,
        recommendation: "Confirm manually before importing. The system will not auto-match by name.",
      });
      continue;
    }

    validRows.push(row);
  }

  return { validRows, issues };
}

async function recommendAdAccount(name: string): Promise<string | undefined> {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const candidates = await prisma.adAccount.findMany({
    where: {
      name: {
        contains: trimmed,
      },
    },
    take: 3,
  });
  if (candidates.length === 0) return undefined;
  return `Possible matches: ${candidates.map((item: { metaAccountId: string; name: string | null }) => `${item.metaAccountId} ${item.name ?? ""}`.trim()).join("; ")}. Manual confirmation required.`;
}

export async function importConfirmedMappings(rows: MappingImportRow[]) {
  let saved = 0;
  for (const row of rows) {
    const store = await prisma.store.findFirstOrThrow({
      where: {
        name: row.store_name,
        platform: row.platform,
        domain: row.domain,
      },
    });
    const adAccount = await prisma.adAccount.findUniqueOrThrow({
      where: { metaAccountId: normalizeMetaAccountId(row.meta_account_id) },
    });
    await bindStoreToAdAccount(store.id, adAccount.id);
    saved++;
  }
  return { saved };
}
