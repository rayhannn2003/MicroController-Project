# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace shared --workspace server --include-workspace-root --ignore-scripts
COPY shared/ shared/
COPY server/ server/
RUN npm run build -w shared && npm run build -w server

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
RUN mkdir -p /data/photos && chown node:node /data/photos
USER node
WORKDIR /app/server
EXPOSE 3100
# Apply pending migrations, then replace the shell with Node so it receives SIGTERM directly.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
