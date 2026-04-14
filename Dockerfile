# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy configuration and package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./

# Install dependencies (frozen lockfile to ensure deterministic builds)
RUN pnpm install --frozen-lockfile

# Copy application source
COPY src/ ./src/

# Compile TypeScript
RUN pnpm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm for prod dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Copy compiled app and manifests
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist

# Install ONLY production dependencies to minimize attack surface
RUN pnpm install --frozen-lockfile --prod

# Execute as unprivileged node user
USER node

EXPOSE 3000

# Start server
CMD ["node", "dist/app.js"]
