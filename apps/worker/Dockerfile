FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --omit=dev --workspace apps/worker --workspace packages/domain

COPY apps/worker apps/worker
COPY packages/domain packages/domain

EXPOSE 8080
CMD ["npm", "--workspace", "apps/worker", "start"]
