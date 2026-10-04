FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/browser-worker ./apps/browser-worker
RUN pnpm install --frozen-lockfile --filter @travelclaw/browser-worker... \
 && pnpm --filter @travelclaw/shared build \
 && pnpm --filter @travelclaw/browser-worker build \
 && pnpm --filter @travelclaw/browser-worker deploy --prod /worker

FROM mcr.microsoft.com/playwright:v1.63.0-noble
ENV NODE_ENV=production
WORKDIR /worker
COPY --from=build --chown=pwuser:pwuser /worker /worker
# The Chromium sandbox is required by the launcher. Do not run this image as root.
USER pwuser
EXPOSE 3001
CMD ["node", "dist/main.js"]
