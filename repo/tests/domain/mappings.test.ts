import { describe, expect, it } from "vitest";
import { parseMappingImportFile } from "../../src/domain/mappings.js";

describe("mapping import parsing", () => {
  it("parses CSV uploads", () => {
    const csv = "store_name,platform,domain,meta_account_id,meta_account_name\nStore A,shopline,storea.com,111,A1";
    expect(parseMappingImportFile({
      fileName: "mapping.csv",
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
    })).toEqual([{
      store_name: "Store A",
      platform: "shopline",
      domain: "storea.com",
      meta_account_id: "111",
      meta_account_name: "A1",
    }]);
  });

  it("parses TSV uploads exported from spreadsheets", () => {
    const tsv = "store_name\tplatform\tdomain\tmeta_account_id\tmeta_account_name\nStore B\tshoplazza\tstoreb.com\tact_333\tB1";
    expect(parseMappingImportFile({
      fileName: "mapping.tsv",
      contentBase64: Buffer.from(tsv, "utf8").toString("base64"),
    })).toEqual([{
      store_name: "Store B",
      platform: "shoplazza",
      domain: "storeb.com",
      meta_account_id: "act_333",
      meta_account_name: "B1",
    }]);
  });
});
