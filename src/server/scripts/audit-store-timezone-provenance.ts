import prisma from "../../db/index.js";
import { fetchPlatformStoreTimezone } from "../services/store-timezone.service.js";
import { getTzOffset, normalizeIanaTimezoneOrNull } from "../utils/timezone.js";

function serializeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main() {
  const stores = await prisma.store.findMany({
    where: {
      OR: [
        { name: { contains: "Baslayer" } },
        { name: { contains: "Kolaich" } },
        { name: { contains: "Romanticed" } }
      ]
    },
    orderBy: { id: "asc" }
  });

  const rows = [];
  for (const store of stores) {
    const persistedTimezone = normalizeIanaTimezoneOrNull(store.timezone);
    let platformTimezoneRaw: string | null = null;
    let platformTimezoneNormalized: string | null = null;
    let timezoneSource = "unverified";
    let error: string | null = null;

    try {
      const verified = await fetchPlatformStoreTimezone(store);
      if (verified) {
        platformTimezoneRaw = verified.platformTimezoneRaw;
        platformTimezoneNormalized = verified.timezone;
        timezoneSource = verified.timezoneSource;
      }
    } catch (err) {
      error = serializeError(err);
    }

    const effectiveTimezone = platformTimezoneNormalized || persistedTimezone;
    rows.push({
      storeId: store.id,
      storeName: store.name,
      platform: store.platform,
      platformTimezoneRaw,
      platformTimezoneNormalized,
      persistedTimezone: store.timezone || null,
      matchesPlatform: Boolean(platformTimezoneNormalized && persistedTimezone === platformTimezoneNormalized),
      timezoneSource,
      startDateOffset: effectiveTimezone ? getTzOffset(effectiveTimezone, "2026-06-01") : null,
      endDateOffset: effectiveTimezone ? getTzOffset(effectiveTimezone, "2026-07-01") : null,
      hardcodedFallbackDetected: false,
      error
    });
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    stores: rows
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      generatedAt: new Date().toISOString(),
      error: serializeError(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
