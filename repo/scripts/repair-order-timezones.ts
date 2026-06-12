import { prisma } from "../src/db/prisma.js";
import { syncStoreProfile } from "../src/domain/store-profile.js";
import {
  convertToStoreLocalTime,
  getStoreLocalDate,
  localDateStringToUtcDate,
  normalizeTimezone,
  SYSTEM_DEFAULT_TIMEZONE,
} from "../src/shared/date-time.js";

async function main() {
  const stores = await prisma.store.findMany({ orderBy: { createdAt: "asc" } });
  let profileSuccess = 0;
  let profileFailed = 0;
  let repairedOrders = 0;
  let missingTimezoneOrders = 0;
  let failedOrders = 0;

  for (const store of stores) {
    let timezone = store.timezone;
    try {
      const result = await syncStoreProfile(store.id);
      timezone = result.store.timezone;
      profileSuccess++;
    } catch {
      profileFailed++;
      if (!timezone) {
        const updated = await prisma.store.update({
          where: { id: store.id },
          data: {
            timezone: SYSTEM_DEFAULT_TIMEZONE,
            timezoneSource: "default",
            timezoneVerifiedAt: new Date(),
          },
        });
        timezone = updated.timezone;
      }
    }

    if (!timezone) {
      const count = await prisma.order.count({ where: { storeId: store.id } });
      missingTimezoneOrders += count;
      continue;
    }

    const storeTimezone = normalizeTimezone(timezone);
    const orders = await prisma.order.findMany({
      where: { storeId: store.id },
      select: { id: true, createdAt: true },
    });

    for (const order of orders) {
      try {
        const localDate = getStoreLocalDate(order.createdAt, storeTimezone);
        await prisma.order.update({
          where: { id: order.id },
          data: {
            createdAtUtc: order.createdAt,
            storeTimezone,
            storeLocalDatetime: convertToStoreLocalTime(order.createdAt, storeTimezone),
            storeLocalDate: localDateStringToUtcDate(localDate),
          },
        });
        repairedOrders++;
      } catch {
        failedOrders++;
      }
    }
  }

  const totalOrders = await prisma.order.count();
  console.log(JSON.stringify({
    totalStores: stores.length,
    timezoneProfileSuccessStores: profileSuccess,
    timezoneProfileFailedStores: profileFailed,
    totalOrders,
    repairedOrders,
    missingTimezoneOrders,
    failedOrders,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
