FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && node scripts/seed.js && node src/server.js"]
