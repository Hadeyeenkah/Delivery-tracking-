# ParcelTrack Dockerfile
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json ./
RUN npm install --omit=dev

# Copy app files
COPY src ./src
COPY views ./views
COPY public ./public
COPY README.md ./

EXPOSE 3000
# Configure admin credentials via environment
# ENV ADMIN_USER=admin
# ENV ADMIN_PASSWORD=change-me
# ENV PORT=3000
CMD ["node", "src/server.js"]
