# Playwright base image ships Chromium + all system deps at a pinned version.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "lib/server.js"]
