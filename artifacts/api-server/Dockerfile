# Ball Boi API image, used by the Cloudflare staging deploy (artifacts/api-host).
# Build context is the repo root: docker build -f artifacts/api-server/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.7 --activate
WORKDIR /app
COPY . .
# Only the API and the workspace libraries it uses.
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..." \
 && pnpm --filter @workspace/api-server run build

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/artifacts/api-server
EXPOSE 8080
# Apply any new SQL migrations, then start the API.
CMD ["sh", "-c", "node ../../scripts/run-db-migrations.mjs && exec node --enable-source-maps ./dist/index.mjs"]
