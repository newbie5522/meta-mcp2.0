#!/usr/bin/env node

import { createServer } from "../../../src/server.js";
import { startHttpTransport } from "../../../src/transport/http.js";
import { logger } from "../../../src/utils/logger.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

startHttpTransport(createServer, port).catch((error) => {
  logger.fatal({ error }, "API app failed to start");
  process.exit(1);
});
