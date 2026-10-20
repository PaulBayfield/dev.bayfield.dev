# Web build + API server in one image.
#   docker build -t devtime .
#   docker run -p 8790:8790 --env-file server/.env devtime

FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src ./src
COPY public ./public
# Language colours are shared with the server.
COPY server/src/colors.json ./server/src/colors.json
RUN npm run build

FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /app/dist /app/dist
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=8790 \
    DIST_DIR=/app/dist \
    APP_VERSION=$APP_VERSION
EXPOSE 8790
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
CMD ["node", "src/index.ts"]
