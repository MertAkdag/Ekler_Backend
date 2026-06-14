# EKLER backend — single image that runs BOTH the API (node dist) and the Admin
# panel (tsx runtime). docker-compose picks the command per service.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# Install deps first (cached unless a package.json / lockfile changes).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile

# Source + build (contracts must be built before the API typechecks against it).
COPY . .
RUN pnpm --filter @ekler/contracts build \
 && pnpm --filter @ekler/api build

ENV NODE_ENV=production
EXPOSE 3010 3020
# Default command = API; the admin service overrides it in docker-compose.yml.
CMD ["node", "apps/api/dist/main.js"]
