# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS development
COPY app/ ./
EXPOSE 5173
CMD ["pnpm", "dev"]

FROM base AS build
ARG SITE_URL
ENV SITE_URL=$SITE_URL
COPY app/ ./
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
USER 101
CMD ["nginx", "-g", "daemon off;"]

