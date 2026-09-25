# syntax=docker/dockerfile:1.4

# ==============================================================================
# Stage 1: Base image with Node.js and system dependencies
# ==============================================================================
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat dumb-init

# ==============================================================================
# Stage 2: Install full dependencies for building
# ==============================================================================
FROM base AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

# ==============================================================================
# Stage 3: Build the targeted microservice
# ==============================================================================
FROM base AS builder
WORKDIR /app

ARG APP_NAME
ENV APP_NAME=${APP_NAME}

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY libs ./libs
COPY apps/${APP_NAME} ./apps/${APP_NAME}

# Compile with Nx and rewrite path aliases via tsc-alias
RUN npx nx build ${APP_NAME} && \
    npx tsc-alias -p apps/${APP_NAME}/tsconfig.app.json --outDir dist/apps/${APP_NAME}

# ==============================================================================
# Stage 4: Install production-only dependencies
# ==============================================================================
FROM base AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# ==============================================================================
# Stage 5: Final lean production runner
# ==============================================================================
FROM base AS runner
WORKDIR /app

ARG APP_NAME
ENV APP_NAME=${APP_NAME}
ENV NODE_ENV=production

# Security: Create non-root user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy production node_modules and compiled output
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/${APP_NAME} ./dist/apps/${APP_NAME}

# Copy gRPC proto definitions (needed at runtime by gRPC loader)
COPY --chown=nestjs:nodejs libs/shared/protos ./libs/shared/protos

USER nestjs

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node dist/apps/${APP_NAME}/apps/${APP_NAME}/src/main.js"]
