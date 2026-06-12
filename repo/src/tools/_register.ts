import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const READ: ToolAnnotations = { readOnlyHint: true };

export const READ_ONLY_DESCRIPTION =
  "Read-only. This tool only performs Meta Graph API GET requests and never creates, updates, pauses, activates, deletes, uploads, or changes ad resources.";
