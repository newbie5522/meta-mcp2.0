// src/hooks/useDataCenter.ts
import { useCallback, useEffect, useState } from "react";

/**
 * ============================================================
 * P0 部署修复：无外部 Query Provider 依赖的数据获取 Hook
 * ============================================================
 *
 * 保持原有返回结构：data / isLoading / error / refetch。
 * 当前测试版不引入 @tanstack/react-query，避免部署期依赖和 Provider 缺失。
 */

interface UseDataCenterOptions {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
}

export function useDataCenter<T = any>(
  endpoint: string,
  options: UseDataCenterOptions = {}
) {
  const { enabled = true } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(enabled));
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!endpoint) return undefined;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`Failed to fetch from ${endpoint}: ${response.status}`);
      }

      const json = await response.json();
      setData(json);
      return json as T;
    } catch (err: any) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      setError(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    refetch().catch(() => {
      // error state is already set inside refetch
    });
  }, [enabled, refetch]);

  return {
    data,
    isLoading,
    error,
    refetch,
    dataSource: "data_center",
    endpoint
  };
}
