export interface AiCopilotPageContext {
  page: string;
  storeId?: string;
  adAccountId?: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  creativeId?: string;
  productId?: string;
  country?: string;
  since?: string;
  until?: string;
  filters?: Record<string, string | number | boolean | null>;
}

export function compactCopilotContext(context: AiCopilotPageContext): AiCopilotPageContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== ""),
  ) as AiCopilotPageContext;
}
