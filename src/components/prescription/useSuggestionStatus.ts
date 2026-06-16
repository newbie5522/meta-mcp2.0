import { useState, useEffect } from "react";

export type SuggestionStatusType = "pending" | "accepted" | "ignored" | "in_progress" | "executed";

export interface SuggestionStatusDetail {
  issueId: string;
  status: SuggestionStatusType;
  acceptedAt?: string;
  ignoredAt?: string;
  executedAt?: string;
  ignoreReason?: string;
  operatorNotes?: string;
  ownerUserName?: string;
  review3dStatus?: "not_started" | "waiting" | "improved" | "no_change" | "worse";
  review7dStatus?: "not_started" | "waiting" | "improved" | "no_change" | "worse";
  review14dStatus?: "not_started" | "waiting" | "improved" | "no_change" | "worse";
}

const LOCAL_STORAGE_KEY = "prescription_status_store";

export function useSuggestionStatus() {
  const [statusMap, setStatusMap] = useState<Record<string, SuggestionStatusDetail>>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error("[useSuggestionStatus INIT ERROR]", e);
      return {};
    }
  });

  const updateStatus = (
    issueId: string,
    status: SuggestionStatusType,
    extra: Partial<Omit<SuggestionStatusDetail, "issueId" | "status">> = {}
  ) => {
    setStatusMap((prev) => {
      const existing = prev[issueId] || { issueId, status: "pending" };
      const nowStr = new Date().toISOString().split("T")[0];
      
      const updated: SuggestionStatusDetail = {
        ...existing,
        ...extra,
        issueId,
        status,
      };

      if (status === "accepted" && !updated.acceptedAt) {
        updated.acceptedAt = nowStr;
      } else if (status === "ignored" && !updated.ignoredAt) {
        updated.ignoredAt = nowStr;
      } else if (status === "executed" && !updated.executedAt) {
        updated.executedAt = nowStr;
      }

      // Default review3d/7d/14d occupancy states if not set and status flows to accepted/in_progress/executed
      if (["accepted", "in_progress", "executed"].includes(status)) {
        if (!updated.review3dStatus) updated.review3dStatus = "waiting";
        if (!updated.review7dStatus) updated.review7dStatus = "waiting";
        if (!updated.review14dStatus) updated.review14dStatus = "not_started";
      }

      const nextMap = {
        ...prev,
        [issueId]: updated,
      };
      
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextMap));
      } catch (e) {
        console.error("[useSuggestionStatus SAVE ERROR]", e);
      }
      return nextMap;
    });
  };

  const getStatusDetail = (issueId: string): SuggestionStatusDetail => {
    return statusMap[issueId] || {
      issueId,
      status: "pending",
      review3dStatus: "not_started",
      review7dStatus: "not_started",
      review14dStatus: "not_started",
    };
  };

  const clearAllStatuses = () => {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      setStatusMap({});
    } catch (e) {
      console.error(e);
    }
  };

  return {
    statusMap,
    updateStatus,
    getStatusDetail,
    clearAllStatuses,
  };
}
