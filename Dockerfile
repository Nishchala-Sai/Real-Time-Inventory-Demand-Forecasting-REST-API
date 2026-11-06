FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/forecast/package.json packages/forecast/
RUN npm ci
COPY frontend frontend
COPY packages packages
RUN npm run build -w frontend

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
COPY packages/forecast/package.json packages/forecast/
RUN npm ci --omit=dev --workspace=backend

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/package.json package.json
COPY backend backend
COPY packages packages
COPY --from=build /app/frontend/dist frontend/dist
WORKDIR /app/backend
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
