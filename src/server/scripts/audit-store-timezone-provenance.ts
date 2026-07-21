import prisma from "../../db/index.js";
import { probePlatformStoreTimezone } from "../services/store-timezone.service.js";
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
  let hasFailure = false;
  for (const store of stores) {
    const persistedTimezone = normalizeIanaTimezoneOrNull(store.timezone);
    let platformTimezoneRaw: string | null = null;
    let platformTimezoneNormalized: string | null = null;
    let timezoneSource = "unverified";
    let finalErrorCode: string | null = null;
    let attempts: any[] = [];

    try {
      const probe = await probePlatformStoreTimezone(store);
      attempts = probe.attempts;
      finalErrorCode = probe.finalErrorCode;
      if (probe.verified) {
        const verified = probe.verified;
        platformTimezoneRaw = verified.platformTimezoneRaw;
        platformTimezoneNormalized = verified.timezone;
        timezoneSource = verified.timezoneSource;
      }
    } catch (err) {
      finalErrorCode = serializeError(err);
    }

    const effectiveTimezone = platformTimezoneNormalized || persistedTimezone;
    const matchesPlatform = Boolean(platformTimezoneNormalized && persistedTimezone === platformTimezoneNormalized);
    if (!matchesPlatform || finalErrorCode) hasFailure = true;
    rows.push({
      storeId: store.id,
      storeName: store.name,
      platform: store.platform,
      persistedTimezone: store.timezone || null,
      platformTimezoneRaw,
      platformTimezoneNormalized,
      timezoneSource,
      matchesPlatform,
      attempts,
      finalErrorCode,
      startDateOffset: effectiveTimezone ? getTzOffset(effectiveTimezone, "2026-06-01") : null,
      endDateOffset: effectiveTimezone ? getTzOffset(effectiveTimezone, "2026-07-01") : null,
      hardcodedFallbackDetected: false
    });
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    stores: rows
  }, null, 2));
  if (hasFailure || rows.length === 0) {
    process.exitCode = 1;
  }
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
