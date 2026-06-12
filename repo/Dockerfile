FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma/ prisma/
RUN npm run db:generate

COPY src/ src/
COPY apps/ apps/
COPY packages/ packages/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV READ_ONLY_MODE=true

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/prisma/ prisma/
COPY --from=builder /app/node_modules/.prisma/ node_modules/.prisma/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/api/src/index.js"]
