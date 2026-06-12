#!/usr/bin/env node

import { startSyncScheduler } from "../../../src/jobs/scheduler.js";
import { logger } from "../../../src/utils/logger.js";

logger.info("Worker app starting scheduled data sync and rule monitoring");
process.env.SYNC_SCHEDULER_ENABLED = process.env.SYNC_SCHEDULER_ENABLED ?? "true";
startSyncScheduler({ force: true });

setInterval(() => {
  logger.debug("Worker heartbeat");
}, 60_000);
