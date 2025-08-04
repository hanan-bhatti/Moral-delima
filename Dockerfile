# Use Node.js Alpine base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl tzdata

# Set timezone
ENV TZ=UTC

# Copy package files first (for caching layers)
COPY package*.json ./

# Install full dependencies (you can switch to production-only later)
RUN npm install && npm cache clean --force \
    && addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy the rest of the application code
COPY --chown=nodejs:nodejs . .

# Create required folders and fix permissions
RUN mkdir -p logs backups && chown -R nodejs:nodejs logs backups

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Healthcheck (optional, useful in Docker or Railway environments)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run the app
CMD ["npm", "start"]