// src/hooks/useDataCenter.ts
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

/**
 * ============================================================
 * P0-003 修复：统一的 Data Center 数据获取 Hook
 * ============================================================
 * 
 * 所有页面都必须使用这个 Hook 来读 Data Center 数据
 * 这样确保数据来源唯一且可审计
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
  const {
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 分钟
    cacheTime = 10 * 60 * 1000  // 10 分钟
  } = options;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['data-center', endpoint],
    queryFn: async () => {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to fetch from ${endpoint}`);
      }
      return response.json();
    },
    enabled,
    staleTime,
    cacheTime,
    // 重要：记录数据来源
    meta: {
      dataSource: 'data_center',
      endpoint,
      fetchedAt: new Date().toISOString()
    }
  });

  return {
    data,
    isLoading,
    error,
    refetch,
    // 添加审计信息
    dataSource: 'data_center',
    endpoint
  };
}
