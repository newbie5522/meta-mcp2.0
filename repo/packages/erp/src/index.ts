export interface ErpOrderSyncAdapter {
  name: string;
  syncOrders(input: { storeId: string; since: Date; until: Date }): Promise<{ fetched: number; saved: number }>;
}

export function createDisabledErpAdapter(): ErpOrderSyncAdapter {
  return {
    name: "disabled",
    async syncOrders() {
      return { fetched: 0, saved: 0 };
    },
  };
}
