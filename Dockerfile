# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy configuration and package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/tsconfig.build.json ./apps/api/tsconfig.build.json
COPY apps/api/nest-cli.json ./apps/api/nest-cli.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/api-types/package.json ./packages/api-types/package.json
COPY packages/auth-core/package.json ./packages/auth-core/package.json
COPY packages/ws-events/package.json ./packages/ws-events/package.json

# Install dependencies (frozen lockfile to ensure deterministic builds)
RUN pnpm install --frozen-lockfile

# Copy shared packages source
COPY packages/ ./packages/

# Generate Prisma Client
RUN cd packages/database && npx prisma generate

# Copy API source
COPY apps/api/ ./apps/api/

# Build API
RUN cd apps/api && pnpm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm for prod dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Copy built output and manifests
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Execute as unprivileged node user
USER node

EXPOSE 8080

# Start NestJS server from the correct location
CMD ["node", "apps/api/dist/main.js"]
