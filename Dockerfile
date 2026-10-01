# --- Build: instala todo y compila el cliente ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime: solo deps de producción + cliente compilado ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY content ./content
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["npm", "start"]
