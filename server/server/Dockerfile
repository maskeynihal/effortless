# Build stage
FROM node:20-bullseye AS builder
WORKDIR /app

# Install dependencies
COPY package*.json tsconfig.json ./
RUN npm install

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Runtime stage
FROM node:20-bullseye AS runner
WORKDIR /app

# Install dependencies (including dev for watch mode support)
COPY package*.json tsconfig.json ./
RUN npm install

# Copy source for ts-node in development
COPY src ./src

# Copy build artifacts
COPY --from=builder /app/dist ./dist

# Copy migrations and scripts
COPY migrations ./migrations
COPY scripts ./scripts
COPY knexfile.cjs ./

# Make startup script executable
RUN chmod +x /app/scripts/start-server.sh

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
