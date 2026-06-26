# Orlanda Forms — multi-stage image. Builds shared+server+client, prunes dev
# deps, ships a slim runtime. Migrations run in the entrypoint before traffic.

# ---- build stage ------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Build tools for native modules (argon2) + openssl for Prisma engines.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install with the full workspace manifest set for deterministic installs.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

# Sources.
COPY prisma ./prisma
COPY shared ./shared
COPY server ./server
COPY client ./client

# Build everything, generate the Prisma client, then drop dev dependencies.
RUN npm run build:shared \
  && npm run prisma:generate \
  && npm run build:server \
  && npm run build:client \
  && npm prune --omit=dev

# ---- runtime stage ----------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Pruned node_modules (includes @prisma/client, the prisma CLI, argon2 binary)
# plus the workspace package.json files the symlinks resolve to.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/package.json ./client/package.json
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/prisma ./prisma
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN chmod +x deploy/entrypoint.sh

EXPOSE 8001
ENTRYPOINT ["./deploy/entrypoint.sh"]
