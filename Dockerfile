# Build Angular
FROM node:20-alpine AS client-builder
WORKDIR /build/client

COPY client/package*.json ./
RUN npm ci --prefer-offline

COPY client/ .
RUN npx ng build --configuration=production

# Build NestJS
FROM node:20-alpine AS server-builder
WORKDIR /build/server

COPY server/package*.json ./
RUN npm ci --prefer-offline

COPY server/ .

# Generate Prisma client for the target platform
RUN npx prisma generate

# Compile TypeScript
RUN npm run build

# Production runtime
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Use node_modules from builder (includes Prisma native binaries)
COPY --from=server-builder /build/server/node_modules ./node_modules

# Compiled server
COPY --from=server-builder /build/server/dist ./dist

# Prisma: generated client + schema + migrations
COPY --from=server-builder /build/server/generated ./generated
COPY --from=server-builder /build/server/prisma ./prisma

COPY --from=client-builder /build/client/dist/client/browser ./public

# Startup script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]