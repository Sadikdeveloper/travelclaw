FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @travelclaw/shared build \
  && pnpm --filter @travelclaw/agent-core build \
  && pnpm --filter @travelclaw/web build \
  && pnpm --filter @travelclaw/api build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/app/data/travelclaw.db
ENV WORKSPACE_PATH=/app/workspace
ENV TRAVELCLAW_MODEL_PROVIDER=mock

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
