FROM node:22-slim

WORKDIR /app

# Install dependencies first so code changes don't invalidate this layer.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

COPY . .
RUN npm run build

# Mount a volume at /data so the index and status history survive redeploys.
ENV POTSCAN_DB=/data/potscan.db
EXPOSE 8787
CMD ["npm", "start"]
