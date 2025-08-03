#!/bin/bash

# Deployment script for Moral Dilemma Platform

set -e

echo "🚀 Starting deployment..."

# Check if required environment variables are set
if [ -z "$NODE_ENV" ]; then
    export NODE_ENV=production
fi

echo "📦 Environment: $NODE_ENV"

# Install dependencies
echo "📥 Installing dependencies..."
npm ci --only=production

# Run database migrations
echo "🔄 Running database migrations..."
node scripts/migrate.js

# Update popularity metrics
echo "📊 Updating popularity metrics..."
node scripts/updateMetrics.js

# Create backup before deployment
echo "💾 Creating backup..."
node scripts/backup.js

# Start the application
echo "🏁 Starting application..."
if [ "$NODE_ENV" = "production" ]; then
    # Use PM2 for production
    if command -v pm2 &> /dev/null; then
        pm2 start ecosystem.config.js --env production
    else
        npm start
    fi
else
    npm run dev
fi

echo "✅ Deployment completed successfully!"