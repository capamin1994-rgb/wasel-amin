# Use Node.js LTS version (20+)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for better-sqlite3 and other native modules
RUN apk add --no-cache python3 make g++ wget git

# Copy package files
COPY package*.json ./

# Update npm to latest version and install dependencies
RUN npm install -g npm@latest && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /tmp/* /var/tmp/*

# Copy application files
COPY . .

# Create necessary directories with proper structure for cloud
RUN mkdir -p uploads src/auth_sessions src/database data public/receipts && \
    chmod -R 755 /app && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001 || exit 1