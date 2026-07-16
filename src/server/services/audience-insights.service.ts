// Compatibility entrypoint. The canonical Audience sync implementation lives in
// meta-audience-breakdown-sync.service.ts so every production caller shares one algorithm.
export {
  fetchAudienceBreakdownEdges,
  syncMetaAudienceBreakdown
} from "./meta-audience-breakdown-sync.service.js";
export type {
  AudienceDimension,
  AudienceEdgeReceipt,
  AudienceSyncResult,
  FailedAudienceSlice
} from "./meta-audience-breakdown-sync.service.js";
