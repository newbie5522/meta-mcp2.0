// @ts-nocheck
import pino from "pino";
import { isStdioTransport } from "./transport-mode.js";

const redact = {
  paths: [
    "access_token",
    "accessToken",
    "token",
    "api_token",
    "apiToken",
    "authorization",
    "headers.authorization",
    "req.headers.authorization",
    "req.headers.x-api-key",
    "x-meta-token",
    "email",
    "customer_email",
    "phone",
    "customer_phone",
    "telephone",
    "address",
    "address1",
    "address2",
    "street",
    "customer",
    "shipping_address",
    "billing_address",
    "contact_email",
    "contact_phone",
    "*.access_token",
    "*.accessToken",
    "*.api_token",
    "*.apiToken",
    "*.email",
    "*.phone",
    "*.address1",
    "*.address2",
    "*.shipping_address",
    "*.billing_address",
  ],
  censor: "[REDACTED]",
};

const isStdio = isStdioTransport(process.argv);

export const logger = isStdio
  ? pino({ level: process.env.LOG_LEVEL ?? "info", redact }, pino.destination({ fd: 2, sync: false }))
  : pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact,
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    });
