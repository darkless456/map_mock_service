FROM node:20-bookworm-slim

WORKDIR /app

COPY mock-server/package.json mock-server/package-lock.json ./
RUN npm ci --omit=dev

COPY mock-server/src/ ./src/
COPY mock-server/scripts/ ./scripts/

RUN mkdir -p /app/data /data/xml

EXPOSE 8080 8082 1883 8083

CMD ["node", "src/index.js"]
