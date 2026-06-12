// @ts-nocheck
export function normalizeAccountId(id: string): string {
  if (typeof id !== "string" || !/^(act_)?\d{1,30}$/.test(id)) {
    throw new Error(`Invalid Meta account_id: ${JSON.stringify(id).slice(0, 80)}`);
  }
  return id.startsWith("act_") ? id : `act_${id}`;
}

export function validateMetaId(id: string, kind = "id"): string {
  if (typeof id !== "string" || !/^(act_\d{1,30}|\d{1,30}(_\d{1,30})?)$/.test(id)) {
    throw new Error(`Invalid Meta ${kind}: ${JSON.stringify(id).slice(0, 80)}`);
  }
  return id;
}

export function truncateResponse(text: string, maxLength = 50000): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n... [Response truncated. Use narrower filters.]`;
}
