# syntax=docker/dockerfile:1.4
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat dumb-init

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

FROM base AS builder
WORKDIR /app
ARG APP_NAME=catalog-service
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY libs ./libs
COPY apps/${APP_NAME} ./apps/${APP_NAME}
RUN npx nx build ${APP_NAME} && \
    npx tsc-alias -p apps/${APP_NAME}/tsconfig.app.json --outDir dist/apps/${APP_NAME}

FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM base AS runner
WORKDIR /app
ARG APP_NAME=catalog-service
ENV APP_NAME=${APP_NAME}
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/${APP_NAME} ./dist/apps/${APP_NAME}
COPY --chown=nestjs:nodejs libs/shared/protos ./libs/shared/protos

USER nestjs
EXPOSE 3002 50052

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/catalog-service/apps/catalog-service/src/main.js"]
