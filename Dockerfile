# Use Node.js LTS version with better optimizations
FROM node:20-alpine

# Set build arguments
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Set working directory
WORKDIR /app

# Install system dependencies with version pinning for stability
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    wget \
    git \
    sqlite \
    && rm -rf /var/cache/apk/*

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies with optimizations
RUN npm config set audit-level moderate && \
    npm config set fund false && \
    npm ci --omit=dev --omit=optional --no-fund --no-audit && \
    npm cache clean --force && \
    rm -rf ~/.npm /tmp/* /var/tmp/* /root/.cache

# Copy application files
COPY . .

# Create application structure with proper permissions
RUN mkdir -p uploads src/auth_sessions src/database data public/receipts logs && \
    chmod -R 755 /app && \
    chown -R node:node /app

# Switch to non-root user for security
USER node

# Expose port
EXPOSE 3001

# Use multi-stage health check script
COPY --chown=node:node health-check.js .

# Enhanced health check with proper endpoint
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
  CMD node health-check.js

# Start server directly (Avoiding npm wrap for better signal handling and path reliability)
CMD ["node", "server.js"]