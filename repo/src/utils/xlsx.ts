import { inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function readUInt16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Invalid XLSX file: zip directory not found.");
}

function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = readUInt32(buffer, eocd + 12);
  const centralDirectoryOffset = readUInt32(buffer, eocd + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  while (offset < end) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error("Invalid XLSX file: malformed zip directory.");
    }
    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (readUInt32(buffer, offset) !== 0x04034b50) {
    throw new Error(`Invalid XLSX file: local header missing for ${entry.name}.`);
  }
  const fileNameLength = readUInt16(buffer, offset + 26);
  const extraLength = readUInt16(buffer, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported XLSX compression method ${entry.compressionMethod}.`);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTagText(xml: string, tagName: string): string[] {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1].replace(/<[^>]+>/g, "")));
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g)) {
    strings.push(extractTagText(match[0], "t").join(""));
  }
  return strings;
}

function cellColumnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return 0;
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function cellValue(cellXml: string, sharedStrings: string[]): string {
  const type = cellXml.match(/\st="([^"]+)"/)?.[1];
  if (type === "inlineStr") {
    return extractTagText(cellXml, "t").join("");
  }
  const value = extractTagText(cellXml, "v")[0] ?? "";
  if (type === "s") {
    const index = Number(value);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  return value;
}

function parseSheetXml(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c(?:\s[^>]*)?>[\s\S]*?<\/c>/g)) {
      const reference = cellMatch[0].match(/\sr="([^"]+)"/)?.[1] ?? "";
      row[cellColumnIndex(reference)] = cellValue(cellMatch[0], sharedStrings).trim();
    }
    if (row.some((value) => value !== undefined && value !== "")) {
      rows.push(row.map((value) => value ?? ""));
    }
  }
  return rows;
}

export function parseFirstXlsxSheet(buffer: Buffer): string[][] {
  const entries = listZipEntries(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const sheetEntry = byName.get("xl/worksheets/sheet1.xml")
    ?? entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
  if (!sheetEntry) {
    throw new Error("Invalid XLSX file: no worksheet found.");
  }

  const sharedStringsEntry = byName.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(readZipEntry(buffer, sharedStringsEntry).toString("utf8"))
    : [];
  return parseSheetXml(readZipEntry(buffer, sheetEntry).toString("utf8"), sharedStrings);
}
