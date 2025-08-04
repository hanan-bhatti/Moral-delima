const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const cron = require('node-cron');
const Redis = require('redis');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
require('dotenv').config();

// Initialize Sentry FIRST - Updated import structure
let Sentry;
if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
  try {
    // Try new Sentry v8+ import structure
    Sentry = require('@sentry/node');
    
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1, // Capture 10% of transactions for performance monitoring
      beforeSend(event) {
        // Filter out sensitive information
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }
        return event;
      }
    });
    console.log('Sentry initialized for error tracking');
  } catch (error) {
    console.warn('Failed to initialize Sentry:', error.message);
    console.log('Continuing without Sentry error tracking');
    Sentry = null;
  }
}

// Import routes
const questionRoutes = require('./routes/questions');
const subscriberRoutes = require('./routes/subscribers');
const adminRoutes = require('./routes/admin');
const analyticsRoutes = require('./routes/analytics');

// Import models for cron jobs
const Question = require('./models/Question');

const app = express();
let server;
let redisClient;
let isShuttingDown = false;
const serverInstanceId = crypto.randomUUID();

// Enhanced Logger Class for Redis
class RedisLogger {
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.serverInfo = {
      instanceId: serverInstanceId,
      hostname: os.hostname(),
      platform: os.platform(),
      nodeVersion: process.version,
      pid: process.pid
    };
  }

  async log(level, message, metadata = {}) {
    if (!this.redisClient || !this.redisClient.isReady) {
      // Fallback to console logging
      console.log(`[${level.toUpperCase()}] ${message}`, metadata);
      return;
    }

    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        metadata,
        server: this.serverInfo
      };

      const logKey = `logs:${level}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      
      // Store individual log entry
      await this.redisClient.setEx(logKey, 86400 * 7, JSON.stringify(logEntry)); // Keep for 7 days
      
      // Add to sorted set for chronological access - FIXED METHOD NAME
      await this.redisClient.zAdd(`logs:timeline:${level}`, {
        score: Date.now(),
        value: logKey
      });
      
      // Keep only last 1000 entries per level - FIXED METHOD NAME
      await this.redisClient.zRemRangeByRank(`logs:timeline:${level}`, 0, -1001);
      
      // Update log statistics
      const statsKey = `logs:stats:${new Date().toISOString().split('T')[0]}`; // Daily stats
      await this.redisClient.hIncrBy(statsKey, level, 1);
      await this.redisClient.expire(statsKey, 86400 * 30); // Keep stats for 30 days
      
    } catch (error) {
      console.error('Failed to log to Redis:', error);
      console.log(`[${level.toUpperCase()}] ${message}`, metadata);
    }
  }

  async info(message, metadata) {
    await this.log('info', message, metadata);
  }

  async warn(message, metadata) {
    await this.log('warn', message, metadata);
  }

  async error(message, metadata) {
    await this.log('error', message, metadata);
    
    // Also send to Sentry if available
    if (Sentry && process.env.NODE_ENV === 'production') {
      Sentry.captureException(new Error(message), {
        tags: { component: 'redis_logger' },
        extra: metadata
      });
    }
  }

  async debug(message, metadata) {
    if (process.env.NODE_ENV === 'development') {
      await this.log('debug', message, metadata);
    }
  }

  async getLogs(level = 'all', limit = 100) {
    if (!this.redisClient || !this.redisClient.isReady) {
      return [];
    }

    try {
      let logKeys = [];
      
      if (level === 'all') {
        // Get logs from all levels
        const levels = ['error', 'warn', 'info', 'debug'];
        for (const lvl of levels) {
          try {
            // FIXED METHOD NAME - use zRange with REV option
            const keys = await this.redisClient.zRange(`logs:timeline:${lvl}`, 0, limit - 1, {
              REV: true  // This makes it work like zRevRange
            });
            logKeys.push(...keys.map(key => ({ key, level: lvl })));
          } catch (error) {
            console.warn(`Failed to get logs for level ${lvl}:`, error.message);
          }
        }
        
        // Sort by timestamp (newer first)
        const logs = await Promise.all(
          logKeys.map(async ({ key }) => {
            try {
              const logData = await this.redisClient.get(key);
              return logData ? JSON.parse(logData) : null;
            } catch {
              return null;
            }
          })
        );
        
        return logs
          .filter(Boolean)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, limit);
      } else {
        // Get logs for specific level
        try {
          // FIXED METHOD NAME - use zRange with REV option
          const keys = await this.redisClient.zRange(`logs:timeline:${level}`, 0, limit - 1, {
            REV: true  // This makes it work like zRevRange
          });
          
          const logs = await Promise.all(
            keys.map(async (key) => {
              try {
                const logData = await this.redisClient.get(key);
                return logData ? JSON.parse(logData) : null;
              } catch {
                return null;
              }
            })
          );
          
          return logs.filter(Boolean);
        } catch (error) {
          console.warn(`Failed to get logs for level ${level}:`, error.message);
          return [];
        }
      }
    } catch (error) {
      console.error('Failed to retrieve logs from Redis:', error);
      return [];
    }
  }

  async getStats(days = 7) {
    if (!this.redisClient || !this.redisClient.isReady) {
      return {};
    }

    try {
      const stats = {};
      const today = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        const statsKey = `logs:stats:${dateKey}`;
        
        const dayStats = await this.redisClient.hGetAll(statsKey);
        if (Object.keys(dayStats).length > 0) {
          stats[dateKey] = dayStats;
        }
      }
      
      return stats;
    } catch (error) {
      console.error('Failed to get log stats from Redis:', error);
      return {};
    }
  }
}

let logger;

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Sentry request handler must be the first middleware - Updated
if (Sentry) {
  try {
    // Try different Sentry middleware approaches based on version
    if (Sentry.Handlers && typeof Sentry.Handlers.requestHandler === 'function') {
      // Sentry v7 style - most common and stable
      app.use(Sentry.Handlers.requestHandler());
      console.log('Sentry request handler (v7 style) initialized');
    } else if (typeof Sentry.requestHandler === 'function') {
      // Alternative v7 style
      app.use(Sentry.requestHandler());
      console.log('Sentry request handler (alternative) initialized');
    } else {
      // Skip middleware if not available
      console.warn('Sentry request handler not available, skipping middleware setup');
    }
  } catch (error) {
    console.warn('Failed to setup Sentry request handler:', error.message);
    console.log('Continuing without Sentry request tracking');
  }
}

// Initialize Redis client with enhanced configuration - FIXED VERSION
const initializeRedis = async () => {
  if (!process.env.REDIS_URL) {
    console.log('Redis URL not provided, skipping Redis initialization');
    return null;
  }

  try {
    redisClient = Redis.createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        keepAlive: 30000,
        reconnectStrategy: (retries, cause) => {
          console.log(`Redis reconnection attempt ${retries}, cause:`, cause.message);
          if (retries > 10) {
            return false; // Stop reconnecting after 10 attempts
          }
          return Math.min(retries * 200, 5000); // Exponential backoff, max 5 seconds
        }
      },
      retry_delay_on_failure: 500,
      retry_delay_on_cluster_down: 500,
      retry_unfulfilled_commands: true,
      maxRetriesPerRequest: 3
    });

    redisClient.on('error', async (err) => {
      console.error('Redis error:', err.message);
      if (logger) {
        await logger.error('Redis connection error', { error: err.message, stack: err.stack });
      }
    });

    redisClient.on('connect', async () => {
      console.log('Redis connected successfully');
      if (logger) {
        await logger.info('Redis connected successfully');
      }
    });

    redisClient.on('reconnecting', async () => {
      console.log('Redis reconnecting...');
      if (logger) {
        await logger.warn('Redis reconnecting');
      }
    });

    redisClient.on('ready', async () => {
      console.log('Redis client ready');
      if (logger) {
        await logger.info('Redis client ready');
      }
    });

    await redisClient.connect();
    
    // Test Redis connection
    await redisClient.ping();
    console.log('Redis connection tested successfully');
    
    // Initialize logger after Redis connection
    logger = new RedisLogger(redisClient);
    await logger.info('Redis logger initialized', { serverInstanceId });
    
    return redisClient;
  } catch (error) {
    console.error('Failed to initialize Redis:', error.message);
    console.log('Continuing without Redis caching and logging');
    
    // Initialize basic logger without Redis
    logger = new RedisLogger(null);
    
    return null;
  }
};

// Request logging middleware with Redis integration
const setupRequestLogging = () => {
  // Custom request logging function
  const logRequest = async (req, res, next) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    
    req.requestId = requestId;
    req.startTime = startTime;
    
    // Log request start
    if (logger) {
      await logger.info('Request started', {
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        query: req.query
      });
    }
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      
      // Log request completion
      if (logger) {
        const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        logger[logLevel]('Request completed', {
          requestId,
          method: req.method,
          path: req.path,
          statusCode,
          duration,
          ip: req.ip,
          contentLength: res.get('Content-Length') || 0
        });
      }
      
      originalEnd.apply(this, args);
    };
    
    next();
  };

  app.use(logRequest);
};

// Redis-enhanced rate limiting store - FIXED VERSION
const createRateLimitStore = () => {
  if (!redisClient) {
    return undefined; // Use default memory store
  }

  return {
    increment: async (key) => {
      try {
        const current = await redisClient.incr(key);
        if (current === 1) {
          await redisClient.expire(key, 900); // 15 minutes
        }
        
        // Log rate limit activity
        if (logger && current > 50) { // Only log when approaching limit
          await logger.warn('High rate limit activity', { key, count: current });
        }
        
        return { totalHits: current, resetTime: new Date(Date.now() + 900000) };
      } catch (error) {
        console.error('Redis rate limit error:', error);
        if (logger) {
          await logger.error('Redis rate limit error', { error: error.message, key });
        }
        return { totalHits: 1, resetTime: new Date(Date.now() + 900000) };
      }
    },
    decrement: async (key) => {
      try {
        await redisClient.decr(key);
      } catch (error) {
        console.error('Redis decrement error:', error);
      }
    },
    resetKey: async (key) => {
      try {
        await redisClient.del(key);
      } catch (error) {
        console.error('Redis reset error:', error);
      }
    }
  };
};

// Ensure logs directory exists
const ensureLogsDirectory = () => {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log('Created logs directory');
  }
};

// Enhanced logging configuration with file rotation
const setupFileLogging = () => {
  ensureLogsDirectory();
  
  if (process.env.NODE_ENV === 'production') {
    // Production logging with file rotation
    const accessLogStream = fs.createWriteStream(
      path.join(__dirname, process.env.ACCESS_LOG_FILE || 'logs/access.log'), 
      { flags: 'a' }
    );
    
    const errorLogStream = fs.createWriteStream(
      path.join(__dirname, process.env.ERROR_LOG_FILE || 'logs/error.log'), 
      { flags: 'a' }
    );
    
    app.use(morgan('combined', {
      stream: accessLogStream,
      skip: (req, res) => res.statusCode >= 400
    }));
    
    app.use(morgan('combined', {
      stream: errorLogStream,
      skip: (req, res) => res.statusCode < 400
    }));
    
    // Console logging for important events only
    app.use(morgan('short', {
      skip: (req, res) => res.statusCode < 400
    }));
  } else {
    // Development logging
    app.use(morgan('dev'));
  }
};

// Enhanced performance monitoring middleware
const performanceMonitoring = () => {
  const performanceData = {
    requests: 0,
    errors: 0,
    avgResponseTime: 0,
    responseTimes: []
  };

  app.use((req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', async () => {
      const responseTime = Date.now() - startTime;
      performanceData.requests++;
      
      if (res.statusCode >= 400) {
        performanceData.errors++;
      }
      
      // Calculate rolling average response time
      performanceData.responseTimes.push(responseTime);
      if (performanceData.responseTimes.length > 1000) {
        performanceData.responseTimes.shift();
      }
      
      performanceData.avgResponseTime = 
        performanceData.responseTimes.reduce((a, b) => a + b, 0) / 
        performanceData.responseTimes.length;
      
      // Log slow requests
      if (responseTime > 5000 && logger) { // Requests taking more than 5 seconds
        await logger.warn('Slow request detected', {
          path: req.path,
          method: req.method,
          responseTime,
          statusCode: res.statusCode,
          ip: req.ip
        });
      }
      
      // Log to Redis for analytics
      if (redisClient && redisClient.isReady) {
        try {
          const metricsKey = `metrics:${new Date().toISOString().split('T')[0]}`;
          await redisClient.hIncrBy(metricsKey, 'total_requests', 1);
          await redisClient.hIncrBy(metricsKey, 'total_response_time', responseTime);
          
          if (res.statusCode >= 400) {
            await redisClient.hIncrBy(metricsKey, 'error_count', 1);
          }
          
          await redisClient.expire(metricsKey, 86400 * 30); // Keep for 30 days
        } catch (error) {
          console.error('Failed to log metrics to Redis:', error);
        }
      }
    });
    
    next();
  });

  // Store performance data globally for health checks
  app.locals.performanceData = performanceData;
};

// Compression middleware for better performance
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Setup logging
setupFileLogging();
setupRequestLogging();
performanceMonitoring();

// Enhanced security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Initialize Redis and create rate limit store
let rateLimitStore;

// Rate limiting with Redis support and enhanced logging
const createRateLimiter = (windowMs, max, message, keyGenerator) => {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore,
    keyGenerator: keyGenerator || ((req) => req.ip),
    handler: async (req, res) => {
      const logData = {
        ip: req.ip,
        path: req.path,
        userAgent: req.get('User-Agent'),
        requestId: req.requestId
      };
      
      console.warn(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      
      if (logger) {
        await logger.warn('Rate limit exceeded', logData);
      }
      
      // Log to Sentry in production
      if (Sentry && process.env.NODE_ENV === 'production') {
        Sentry.addBreadcrumb({
          message: 'Rate limit exceeded',
          level: 'warning',
          data: logData
        });
      }
      
      res.status(429).json({
        error: 'Too many requests',
        message: message.error || 'Rate limit exceeded',
        retryAfter: Math.ceil(windowMs / 1000),
        requestId: req.requestId
      });
    }
  });
};

// Rate limiters
const generalLimiter = createRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60
  }
);

const apiLimiter = createRateLimiter(
  15 * 60 * 1000,
  parseInt(process.env.API_RATE_LIMIT_MAX) || 200,
  {
    error: 'Too many API requests from this IP, please try again later.',
    retryAfter: 15 * 60
  }
);

const responseLimiter = createRateLimiter(
  60 * 60 * 1000,
  parseInt(process.env.RESPONSE_RATE_LIMIT_MAX) || 50,
  {
    error: 'Too many responses from this IP, please try again later.',
    retryAfter: 60 * 60
  }
);

// Apply general rate limiting
app.use(generalLimiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      if (logger) {
        logger.warn('CORS blocked origin', { origin, userAgent: origin });
      }
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Requested-With'],
  maxAge: 86400 // Cache preflight requests for 24 hours
};

app.use(cors(corsOptions));

// Body parsing middleware with enhanced security
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      if (logger) {
        logger.warn('Invalid JSON received', { 
          ip: req.ip, 
          path: req.path, 
          error: e.message 
        });
      }
      res.status(400).json({ error: 'Invalid JSON' });
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Serve static files with enhanced caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Add this temporarily right after your middleware setup
app.get('/api/test', (req, res) => {
  console.log('🧪 Test API endpoint hit');
  res.json({ 
    success: true, 
    message: 'API routing is working!',
    timestamp: new Date().toISOString()
  });
});

// Enhanced health check endpoint with comprehensive system info
app.get('/health', async (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: 'disconnected',
    redis: 'disconnected',
    serverInfo: {
      instanceId: serverInstanceId,
      hostname: os.hostname(),
      platform: os.platform(),
      nodeVersion: process.version,
      pid: process.pid,
      cpuUsage: process.cpuUsage(),
      loadAverage: os.loadavg()
    },
    performance: app.locals.performanceData || {}
  };

  // Check database connection
  try {
    if (mongoose.connection.readyState === 1) {
      healthData.database = 'connected';
      // Test database with a simple query
      await mongoose.connection.db.admin().ping();
    }
  } catch (error) {
    healthData.database = 'error';
    healthData.databaseError = error.message;
  }

  // Check Redis connection
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.ping();
      healthData.redis = 'connected';
      
      // Get Redis info
      const redisInfo = await redisClient.info('memory');
      healthData.redisMemory = redisInfo;
    }
  } catch (error) {
    healthData.redis = 'error';
    healthData.redisError = error.message;
  }

  const isHealthy = healthData.database === 'connected';
  const statusCode = isHealthy ? 200 : 503;

  if (!isHealthy) {
    healthData.status = 'unhealthy';
    
    if (logger) {
      await logger.error('Health check failed', healthData);
    }
  }

  // Enhanced HTML response with more detailed information
  const uptimeFormatted = Math.floor(healthData.uptime / 3600) + 'h ' + 
                         Math.floor((healthData.uptime % 3600) / 60) + 'm ' + 
                         Math.floor(healthData.uptime % 60) + 's';

  const memoryFormatted = {
    rss: (healthData.memory.rss / 1024 / 1024).toFixed(2) + ' MB',
    heapTotal: (healthData.memory.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
    heapUsed: (healthData.memory.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
    external: (healthData.memory.external / 1024 / 1024).toFixed(2) + ' MB'
  };

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Health Check - ${healthData.serverInfo.hostname}</title>
      <style>
        body { 
          font-family: system-ui, sans-serif; 
          margin: 2rem; 
          background: #f5f5f5; 
        }
        .container { 
          max-width: 800px; 
          background: white; 
          padding: 2rem; 
          border-radius: 8px; 
          box-shadow: 0 2px 8px rgba(0,0,0,0.1); 
        }
        .status { 
          color: white; 
          padding: 0.5rem 1rem; 
          border-radius: 4px; 
          display: inline-block; 
          margin-bottom: 1rem; 
        }
        .healthy { background: #22c55e; }
        .unhealthy { background: #ef4444; }
        .connected { color: #22c55e; font-weight: bold; }
        .disconnected { color: #ef4444; font-weight: bold; }
        .error { color: #f59e0b; font-weight: bold; }
        h1 { 
          margin: 0 0 1.5rem 0; 
          color: #333; 
        }
        .info { 
          margin: 1rem 0; 
          padding: 1rem; 
          background: #f8f9fa; 
          border-radius: 4px; 
        }
        .row { 
          display: flex; 
          justify-content: space-between; 
          margin: 0.5rem 0; 
        }
        .label { 
          font-weight: 500; 
        }
        .value { 
          font-family: monospace; 
        }
        button { 
          background: #3b82f6; 
          color: white; 
          border: none; 
          padding: 0.75rem 1.5rem; 
          border-radius: 4px; 
          cursor: pointer; 
          margin: 0.5rem 0.5rem 0 0; 
        }
        button:hover {
          background: #2563eb;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1rem;
        }
        .performance {
          background: #e3f2fd;
          border-left: 4px solid #2196f3;
        }
        .server-info {
          background: #f3e5f5;
          border-left: 4px solid #9c27b0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status ${healthData.status === 'healthy' ? 'healthy' : 'unhealthy'}">${healthData.status}</div>
        <h1>System Health - ${healthData.serverInfo.hostname}</h1>
        
        <div class="grid">
          <div class="info">
            <h3>System Status</h3>
            <div class="row">
              <span class="label">Status:</span>
              <span class="value">${healthData.status}</span>
            </div>
            <div class="row">
              <span class="label">Environment:</span>
              <span class="value">${healthData.environment}</span>
            </div>
            <div class="row">
              <span class="label">Version:</span>
              <span class="value">${healthData.version}</span>
            </div>
            <div class="row">
              <span class="label">Uptime:</span>
              <span class="value">${uptimeFormatted}</span>
            </div>
          </div>

          <div class="info server-info">
            <h3>Server Info</h3>
            <div class="row">
              <span class="label">Instance ID:</span>
              <span class="value">${healthData.serverInfo.instanceId.substring(0, 8)}...</span>
            </div>
            <div class="row">
              <span class="label">Hostname:</span>
              <span class="value">${healthData.serverInfo.hostname}</span>
            </div>
            <div class="row">
              <span class="label">Platform:</span>
              <span class="value">${healthData.serverInfo.platform}</span>
            </div>
            <div class="row">
              <span class="label">Node Version:</span>
              <span class="value">${healthData.serverInfo.nodeVersion}</span>
            </div>
            <div class="row">
              <span class="label">PID:</span>
              <span class="value">${healthData.serverInfo.pid}</span>
            </div>
          </div>
        </div>

        <div class="grid">
          <div class="info">
            <h3>Services</h3>
            <div class="row">
              <span class="label">Database:</span>
              <span class="value ${healthData.database}">${healthData.database}</span>
            </div>
            <div class="row">
              <span class="label">Redis:</span>
              <span class="value ${healthData.redis}">${healthData.redis}</span>
            </div>
            ${healthData.databaseError ? `
            <div class="row">
              <span class="label">DB Error:</span>
              <span class="value error">${healthData.databaseError}</span>
            </div>
            ` : ''}
            ${healthData.redisError ? `
            <div class="row">
              <span class="label">Redis Error:</span>
              <span class="value error">${healthData.redisError}</span>
            </div>
            ` : ''}
          </div>

          <div class="info performance">
            <h3>Performance</h3>
            <div class="row">
              <span class="label">Total Requests:</span>
              <span class="value">${healthData.performance.requests || 0}</span>
            </div>
            <div class="row">
              <span class="label">Error Count:</span>
              <span class="value">${healthData.performance.errors || 0}</span>
            </div>
            <div class="row">
              <span class="label">Avg Response Time:</span>
              <span class="value">${Math.round(healthData.performance.avgResponseTime || 0)}ms</span>
            </div>
            <div class="row">
              <span class="label">Load Average:</span>
              <span class="value">${healthData.serverInfo.loadAverage.map(load => load.toFixed(2)).join(', ')}</span>
            </div>
          </div>
        </div>

        <div class="info">
          <h3>Memory Usage</h3>
          <div class="grid">
            <div>
              <div class="row">
                <span class="label">RSS:</span>
                <span class="value">${memoryFormatted.rss}</span>
              </div>
              <div class="row">
                <span class="label">Heap Total:</span>
                <span class="value">${memoryFormatted.heapTotal}</span>
              </div>
            </div>
            <div>
              <div class="row">
                <span class="label">Heap Used:</span>
                <span class="value">${memoryFormatted.heapUsed}</span>
              </div>
              <div class="row">
                <span class="label">External:</span>
                <span class="value">${memoryFormatted.external}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="info">
          <h3>Last Updated</h3>
          <div class="row">
            <span class="label">Timestamp:</span>
            <span class="value">${healthData.timestamp}</span>
          </div>
        </div>

        <button id="refreshBtn">Refresh Status</button>
        <button id="logsBtn">View Logs</button>
        <button id="metricsBtn">View Metrics</button>
      </div>

      <script>
        // Event listeners instead of inline handlers
        document.getElementById('refreshBtn').addEventListener('click', function() {
          window.location.reload();
        });
        
        document.getElementById('logsBtn').addEventListener('click', function() {
          window.location.href = '/api/logs';
        });
        
        document.getElementById('metricsBtn').addEventListener('click', function() {
          window.location.href = '/api/metrics';
        });

        // Auto-refresh every 30 seconds
        setTimeout(function() {
          window.location.reload();
        }, 30000);
      </script>
    </body>
    </html>
  `;

  res.status(statusCode).send(html);
});

// Logs viewing endpoint - FIXED VERSION
app.get('/api/logs', async (req, res) => {
  if (!logger) {
    return res.status(503).json({ error: 'Logging not available' });
  }

  const { level = 'all', limit = 100, format = 'html' } = req.query;
  
  try {
    const logs = await logger.getLogs(level, parseInt(limit));
    
    if (format === 'json') {
      return res.json({ logs, count: logs.length });
    }
    
    // HTML format for viewing in browser
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>System Logs</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 2rem; background: #f5f5f5; }
          .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: #1f2937; color: white; padding: 2rem; }
          .filters { padding: 1rem; background: #f8f9fa; border-bottom: 1px solid #e5e7eb; }
          .filters select, .filters input { margin: 0 0.5rem; padding: 0.5rem; border-radius: 4px; border: 1px solid #ccc; }
          .filters button { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin: 0 0.5rem; }
          .filters button:hover { background: #2563eb; }
          .log-entry { padding: 1rem; border-bottom: 1px solid #e5e7eb; }
          .log-entry:hover { background: #f8f9fa; }
          .log-level { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 3px; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-right: 0.5rem; }
          .level-error { background: #ef4444; color: white; }
          .level-warn { background: #f59e0b; color: white; }
          .level-info { background: #22c55e; color: white; }
          .level-debug { background: #6b7280; color: white; }
          .timestamp { color: #6b7280; font-size: 0.875rem; }
          .message { font-weight: 500; margin: 0.25rem 0; }
          .metadata { background: #f1f5f9; padding: 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.875rem; white-space: pre-wrap; }
          .no-logs { text-align: center; padding: 2rem; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>System Logs</h1>
            <p>Viewing ${logs.length} log entries</p>
          </div>
          
          <div class="filters">
            <label>Level: 
              <select id="levelSelect">
                <option value="all" ${level === 'all' ? 'selected' : ''}>All</option>
                <option value="error" ${level === 'error' ? 'selected' : ''}>Error</option>
                <option value="warn" ${level === 'warn' ? 'selected' : ''}>Warning</option>
                <option value="info" ${level === 'info' ? 'selected' : ''}>Info</option>
                <option value="debug" ${level === 'debug' ? 'selected' : ''}>Debug</option>
              </select>
            </label>
            
            <label>Limit: 
              <select id="limitSelect">
                <option value="5" ${limit === '5' ? 'selected' : ''}>5</option>
                <option value="10" ${limit === '10' ? 'selected' : ''}>10</option>
                <option value="20" ${limit === '20' ? 'selected' : ''}>20</option>
                <option value="30" ${limit === '30' ? 'selected' : ''}>30</option>
                <option value="40" ${limit === '40' ? 'selected' : ''}>40</option>
                <option value="50" ${limit === '50' ? 'selected' : ''}>50</option>
                <option value="75" ${limit === '75' ? 'selected' : ''}>75</option>
                <option value="100" ${limit === '100' ? 'selected' : ''}>100</option>
                <option value="200" ${limit === '200' ? 'selected' : ''}>200</option>
                <option value="250" ${limit === '250' ? 'selected' : ''}>250</option>
                <option value="300" ${limit === '300' ? 'selected' : ''}>300</option>
                <option value="400" ${limit === '400' ? 'selected' : ''}>400</option>
                <option value="500" ${limit === '500' ? 'selected' : ''}>500</option>
                <option value="750" ${limit === '750' ? 'selected' : ''}>750</option>
                <option value="1000" ${limit === '1000' ? 'selected' : ''}>1000</option>
              </select>
            </label>
            
            <button id="refreshBtn">Refresh</button>
            <button id="jsonBtn">JSON</button>
          </div>
          
          <div class="logs">
            ${logs.length === 0 ? '<div class="no-logs">No logs found</div>' : logs.map(log => `
              <div class="log-entry">
                <span class="log-level level-${log.level}">${log.level}</span>
                <span class="timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                <div class="message">${log.message}</div>
                ${Object.keys(log.metadata || {}).length > 0 ? `
                  <div class="metadata">${JSON.stringify(log.metadata, null, 2)}</div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
        
        <script>
          // Event listeners for filter changes
          document.getElementById('levelSelect').addEventListener('change', function() {
            const level = this.value;
            const limit = document.getElementById('limitSelect').value;
            window.location.href = '?level=' + level + '&limit=' + limit;
          });

          document.getElementById('limitSelect').addEventListener('change', function() {
            const level = document.getElementById('levelSelect').value;
            const limit = this.value;
            window.location.href = '?level=' + level + '&limit=' + limit;
          });

          document.getElementById('refreshBtn').addEventListener('click', function() {
            window.location.reload();
          });

          document.getElementById('jsonBtn').addEventListener('click', function() {
            const level = document.getElementById('levelSelect').value;
            const limit = document.getElementById('limitSelect').value;
            window.location.href = '?level=' + level + '&limit=' + limit + '&format=json';
          });

          // Auto-refresh every 30 seconds
          setTimeout(function() {
            window.location.reload();
          }, 30000);
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (error) {
    console.error('Error retrieving logs:', error);
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

// Metrics endpoint - FIXED VERSION
app.get('/api/metrics', async (req, res) => {
  if (!redisClient || !redisClient.isReady) {
    return res.status(503).json({ error: 'Metrics not available - Redis required' });
  }

  const { format = 'html', days = 7 } = req.query;
  
  try {
    const metrics = {};
    const today = new Date();
    
    // Get daily metrics
    for (let i = 0; i < parseInt(days); i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const metricsKey = `metrics:${dateKey}`;
      
      const dayMetrics = await redisClient.hGetAll(metricsKey);
      if (Object.keys(dayMetrics).length > 0) {
        metrics[dateKey] = {
          total_requests: parseInt(dayMetrics.total_requests || 0),
          total_response_time: parseInt(dayMetrics.total_response_time || 0),
          error_count: parseInt(dayMetrics.error_count || 0),
          avg_response_time: dayMetrics.total_requests ? 
            Math.round(parseInt(dayMetrics.total_response_time) / parseInt(dayMetrics.total_requests)) : 0
        };
      }
    }
    
    // Get log stats
    const logStats = logger ? await logger.getStats(parseInt(days)) : {};
    
    if (format === 'json') {
      return res.json({ metrics, logStats });
    }
    
    // HTML format
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>System Metrics</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 2rem; background: #f5f5f5; }
          .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background: #1f2937; color: white; padding: 2rem; }
          .section { padding: 2rem; border-bottom: 1px solid #e5e7eb; }
          .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; }
          .metric-card { background: #f8f9fa; padding: 1.5rem; border-radius: 8px; border-left: 4px solid #3b82f6; }
          .metric-value { font-size: 2rem; font-weight: bold; color: #1f2937; }
          .metric-label { color: #6b7280; font-size: 0.875rem; text-transform: uppercase; }
          .chart { margin: 1rem 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
          th { background: #f8f9fa; font-weight: 600; }
          .no-data { text-align: center; padding: 2rem; color: #6b7280; }
          button { background: #3b82f6; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; cursor: pointer; margin: 0.5rem 0.5rem 0 0; }
          button:hover { background: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>System Metrics</h1>
            <p>Last ${days} days of system performance data</p>
          </div>
          
          <div class="section">
            <h2>Daily Request Metrics</h2>
            ${Object.keys(metrics).length === 0 ? '<div class="no-data">No metrics data available</div>' : `
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Total Requests</th>
                    <th>Error Count</th>
                    <th>Error Rate</th>
                    <th>Avg Response Time</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(metrics).map(([date, data]) => `
                    <tr>
                      <td>${date}</td>
                      <td>${data.total_requests.toLocaleString()}</td>
                      <td>${data.error_count.toLocaleString()}</td>
                      <td>${data.total_requests ? ((data.error_count / data.total_requests) * 100).toFixed(2) : 0}%</td>
                      <td>${data.avg_response_time}ms</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
          
          <div class="section">
            <h2>Daily Log Statistics</h2>
            ${Object.keys(logStats).length === 0 ? '<div class="no-data">No log statistics available</div>' : `
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Error Logs</th>
                    <th>Warning Logs</th>
                    <th>Info Logs</th>
                    <th>Debug Logs</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(logStats).map(([date, data]) => {
                    const total = Object.values(data).reduce((sum, count) => sum + parseInt(count || 0), 0);
                    return `
                      <tr>
                        <td>${date}</td>
                        <td>${data.error || 0}</td>
                        <td>${data.warn || 0}</td>
                        <td>${data.info || 0}</td>
                        <td>${data.debug || 0}</td>
                        <td>${total}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>
          
          <div class="section">
            <button id="refreshBtn">Refresh</button>
            <button id="day1Btn">1 Day</button>
            <button id="day7Btn">7 Days</button>
            <button id="day30Btn">30 Days</button>
            <button id="jsonBtn">JSON</button>
          </div>
        </div>

        <script>
          // Event listeners for buttons
          document.getElementById('refreshBtn').addEventListener('click', function() {
            window.location.reload();
          });

          document.getElementById('day1Btn').addEventListener('click', function() {
            window.location.href = '?days=1&format=${format}';
          });

          document.getElementById('day7Btn').addEventListener('click', function() {
            window.location.href = '?days=7&format=${format}';
          });

          document.getElementById('day30Btn').addEventListener('click', function() {
            window.location.href = '?days=30&format=${format}';
          });

          document.getElementById('jsonBtn').addEventListener('click', function() {
            window.location.href = '?days=${days}&format=json';
          });
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (error) {
    console.error('Error retrieving metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// API documentation route - Enhanced with Redis info
app.get('/api/docs', (req, res) => {
  const apiDocs = {
    title: 'Moral Dilemma API Documentation',
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development',
    features: {
      redis: !!redisClient,
      sentry: !!Sentry && !!(process.env.SENTRY_DSN && process.env.NODE_ENV === 'production'),
      rateLimiting: true,
      caching: !!redisClient,
      logging: !!logger,
      metrics: !!redisClient
    },
    endpoints: {
      questions: {
        'GET /api/questions': 'Get latest questions with sorting options',
        'GET /api/questions/categories': 'Get all categories with statistics',
        'GET /api/questions/category/:category': 'Get questions by category with filtering',
        'GET /api/questions/:category/:slug': 'Get specific question with view tracking',
        'POST /api/questions/:category/:slug/respond': 'Add response to question',
        'GET /api/questions/:category/:slug/responses': 'Get responses for a question',
        'GET /api/questions/trending': 'Get trending questions',
        'GET /api/questions/popular': 'Get most popular questions',
        'GET /api/questions/stats': 'Get overall statistics',
        'GET /api/questions/search': 'Search questions',
        'POST /api/questions/update-metrics': 'Update popularity metrics'
      },
      analytics: {
        'GET /api/analytics/dashboard': 'Get dashboard analytics',
        'GET /api/analytics/question/:category/:slug': 'Get detailed question analytics',
        'GET /api/analytics/category/:category': 'Get category-specific analytics',
        'GET /api/analytics/trends': 'Get trending analysis',
        'POST /api/analytics/recalculate': 'Recalculate all popularity metrics',
        'GET /api/analytics/export': 'Export analytics data'
      },
      system: {
        'GET /health': 'System health check with detailed status',
        'GET /api/logs': 'View system logs (supports ?level=error&limit=100&format=json)',
        'GET /api/metrics': 'View system metrics (supports ?days=7&format=json)',
        'GET /api/docs': 'This API documentation'
      }
    },
    parameters: {
      sortBy: ['popularity', 'trending', 'newest', 'most_responses'],
      questionType: ['all', 'multiple_choice', 'paragraph'],
      timeRange: ['24h', '7d', '30d', 'all'],
      format: ['json', 'csv', 'html'],
      logLevel: ['all', 'error', 'warn', 'info', 'debug']
    },
    rateLimits: {
      general: `${process.env.RATE_LIMIT_MAX_REQUESTS || 100} requests per 15 minutes`,
      api: `${process.env.API_RATE_LIMIT_MAX || 200} requests per 15 minutes`,
      responses: `${process.env.RESPONSE_RATE_LIMIT_MAX || 50} requests per hour`
    }
  };
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${apiDocs.title}</title>
      <style>
        body {
          font-family: system-ui, sans-serif;
          margin: 2rem;
          background: #f5f5f5;
          line-height: 1.6;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          overflow: hidden;
        }
        .header {
          background: #1f2937;
          color: white;
          padding: 2rem;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 2rem;
        }
        .version {
          background: rgba(255,255,255,0.2);
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          margin-top: 0.5rem;
          font-size: 0.9rem;
        }
        .features {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        }
        .feature {
          background: rgba(255,255,255,0.1);
          padding: 0.25rem 0.5rem;
          border-radius: 3px;
          font-size: 0.8rem;
        }
        .feature.enabled {
          background: #22c55e;
        }
        .feature.disabled {
          background: #6b7280;
        }
        .content {
          padding: 2rem;
        }
        .section {
          margin-bottom: 2rem;
        }
        .section h2 {
          color: #1f2937;
          border-bottom: 2px solid #3b82f6;
          padding-bottom: 0.5rem;
          margin-bottom: 1rem;
        }
        .endpoint-group {
          background: #f8f9fa;
          border-radius: 6px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          border-left: 4px solid #3b82f6;
        }
        .endpoint-group h3 {
          color: #374151;
          margin: 0 0 1rem 0;
          text-transform: capitalize;
        }
        .endpoint {
          display: flex;
          align-items: center;
          margin-bottom: 0.75rem;
          padding: 0.75rem;
          background: white;
          border-radius: 4px;
          border: 1px solid #e5e7eb;
        }
        .method {
          font-weight: bold;
          padding: 0.25rem 0.5rem;
          border-radius: 3px;
          font-size: 0.75rem;
          margin-right: 1rem;
          min-width: 50px;
          text-align: center;
        }
        .method.get {
          background: #22c55e;
          color: white;
        }
        .method.post {
          background: #f59e0b;
          color: white;
        }
        .path {
          font-family: monospace;
          font-weight: 600;
          color: #1f2937;
          flex: 1;
          margin-right: 1rem;
        }
        .description {
          color: #6b7280;
          font-style: italic;
        }
        .param-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
        }
        .param-card {
          background: #f8f9fa;
          border-radius: 6px;
          padding: 1rem;
          border-left: 4px solid #22c55e;
        }
        .param-card h4 {
          margin: 0 0 0.75rem 0;
          color: #374151;
        }
        .param-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .param-list li {
          background: white;
          margin-bottom: 0.5rem;
          padding: 0.5rem;
          border-radius: 3px;
          border: 1px solid #e5e7eb;
          font-family: monospace;
          font-size: 0.9rem;
        }
        .search-box {
          width: 100%;
          padding: 0.75rem;
          border: 2px solid #e5e7eb;
          border-radius: 6px;
          font-size: 1rem;
          margin-bottom: 1rem;
        }
        .search-box:focus {
          outline: none;
          border-color: #3b82f6;
        }
        .back-btn {
          background: #3b82f6;
          color: white;
          text-decoration: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          display: inline-block;
          margin: 0.5rem 0.5rem 0 0;
        }
        .back-btn:hover {
          background: #2563eb;
        }
        .hidden {
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${apiDocs.title}</h1>
          <div class="version">Version ${apiDocs.version} (${apiDocs.environment})</div>
          <div class="features">
            <div class="feature ${apiDocs.features.redis ? 'enabled' : 'disabled'}">
              Redis: ${apiDocs.features.redis ? 'Enabled' : 'Disabled'}
            </div>
            <div class="feature ${apiDocs.features.sentry ? 'enabled' : 'disabled'}">
              Sentry: ${apiDocs.features.sentry ? 'Enabled' : 'Disabled'}
            </div>
            <div class="feature enabled">Rate Limiting: Enabled</div>
            <div class="feature ${apiDocs.features.caching ? 'enabled' : 'disabled'}">
              Caching: ${apiDocs.features.caching ? 'Enabled' : 'Disabled'}
            </div>
            <div class="feature ${apiDocs.features.logging ? 'enabled' : 'disabled'}">
              Logging: ${apiDocs.features.logging ? 'Enabled' : 'Disabled'}
            </div>
            <div class="feature ${apiDocs.features.metrics ? 'enabled' : 'disabled'}">
              Metrics: ${apiDocs.features.metrics ? 'Enabled' : 'Disabled'}
            </div>
          </div>
        </div>
        
        <div class="content">
          <input type="text" class="search-box" id="searchBox" placeholder="Search endpoints...">
          
          <div class="section">
            <h2>Rate Limits</h2>
            <div class="param-grid">
              ${Object.entries(apiDocs.rateLimits).map(([type, limit]) => `
                <div class="param-card">
                  <h4>${type.charAt(0).toUpperCase() + type.slice(1)} Endpoints</h4>
                  <div style="background: white; padding: 0.5rem; border-radius: 3px; border: 1px solid #e5e7eb; font-family: monospace; font-size: 0.9rem;">
                    ${limit}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="section">
            <h2>API Endpoints</h2>
            
            ${Object.entries(apiDocs.endpoints).map(([groupName, endpoints]) => `
              <div class="endpoint-group" data-group="${groupName}">
                <h3>${groupName} endpoints</h3>
                ${Object.entries(endpoints).map(([endpoint, description]) => {
                  const [method, path] = endpoint.split(' ');
                  return `
                    <div class="endpoint" data-endpoint="${endpoint.toLowerCase()} ${description.toLowerCase()}">
                      <span class="method ${method.toLowerCase()}">${method}</span>
                      <span class="path">${path}</span>
                      <span class="description">${description}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            `).join('')}
          </div>

          <div class="section">
            <h2>Parameters</h2>
            <div class="param-grid">
              ${Object.entries(apiDocs.parameters).map(([paramName, values]) => `
                <div class="param-card">
                  <h4>${paramName}</h4>
                  <ul class="param-list">
                    ${values.map(value => `<li>${value}</li>`).join('')}
                  </ul>
                </div>
              `).join('')}
            </div>
          </div>

          <a href="/" class="back-btn">Back to Home</a>
          <a href="/health" class="back-btn">Health Check</a>
          <a href="/api/logs" class="back-btn">View Logs</a>
          <a href="/api/metrics" class="back-btn">View Metrics</a>
        </div>
      </div>

      <script>
        document.getElementById('searchBox').addEventListener('keyup', function(e) {
          const query = e.target.value.toLowerCase();
          const endpoints = document.querySelectorAll('.endpoint');
          const groups = document.querySelectorAll('.endpoint-group');
          
          if (!query) {
            endpoints.forEach(function(ep) {
              ep.classList.remove('hidden');
            });
            groups.forEach(function(group) {
              group.classList.remove('hidden');
            });
            return;
          }
          
          groups.forEach(function(group) {
            const groupEndpoints = group.querySelectorAll('.endpoint');
            let hasVisibleEndpoints = false;
            
            groupEndpoints.forEach(function(endpoint) {
              const searchText = endpoint.getAttribute('data-endpoint');
              if (searchText.includes(query)) {
                endpoint.classList.remove('hidden');
                hasVisibleEndpoints = true;
              } else {
                endpoint.classList.add('hidden');
              }
            });
            
            if (hasVisibleEndpoints) {
              group.classList.remove('hidden');
            } else {
              group.classList.add('hidden');
            }
          });
        });
      </script>
    </body>
    </html>
  `;

  res.send(html);
});

// Admin routes - BEFORE DYNAMIC ROUTES
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-analytics.html'));
});

// API Routes with specific rate limiting
app.use('/api/questions', apiLimiter, questionRoutes);
app.use('/api/subscribers', apiLimiter, subscriberRoutes);
app.use('/api/admin', adminRoutes); // Admin routes should have their own auth-based limiting
app.use('/api/analytics', apiLimiter, analyticsRoutes);

// Apply response rate limiting to response endpoints
app.use('/api/questions/:category/:slug/respond', responseLimiter);

// STATIC PAGE ROUTES - BEFORE DYNAMIC ROUTES

// Homepage route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Categories page route - Shows all categories with stats
app.get('/categories', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'categories.html'));
});

// Trending page route - Shows trending questions
app.get('/trending', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trending.html'));
});

// About page route - Shows platform statistics and information
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// DYNAMIC ROUTES - MUST BE AFTER STATIC ROUTES

// Category page route - Shows questions in a specific category
app.get('/category/:category', async (req, res) => {
  const { category } = req.params;
  
  // Validate category
  const validCategories = [
    'love', 'justice', 'survival', 'family', 'freedom', 'sacrifice',
    'truth', 'loyalty', 'revenge', 'power', 'empathy', 'morality',
    'desire', 'regret', 'identity', 'betrayal', 'hope', 'fear',
    'faith', 'control', 'loss', 'trust', 'responsibility', 'choice',
    'pain', 'greed', 'envy', 'honor', 'duty', 'self'
  ];
  
  if (!validCategories.includes(category.toLowerCase())) {
    if (logger) {
      await logger.warn('Invalid category access attempt', { 
        category, 
        ip: req.ip, 
        userAgent: req.get('User-Agent') 
      });
    }
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  // Log valid category access
  if (logger) {
    await logger.info('Category page accessed', { 
      category, 
      ip: req.ip 
    });
  }
  
  // Serve the category HTML file - the frontend will fetch data via API
  res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Question page route - MUST BE LAST DYNAMIC ROUTE
app.get('/:category/:slug', async (req, res) => {
  const { category } = req.params;
  
  // Validate category to prevent matching non-category routes
  const validCategories = [
    'love', 'justice', 'survival', 'family', 'freedom', 'sacrifice',
    'truth', 'loyalty', 'revenge', 'power', 'empathy', 'morality',
    'desire', 'regret', 'identity', 'betrayal', 'hope', 'fear',
    'faith', 'control', 'loss', 'trust', 'responsibility', 'choice',
    'pain', 'greed', 'envy', 'honor', 'duty', 'self'
  ];
  
  if (!validCategories.includes(category.toLowerCase())) {
    if (logger) {
      await logger.warn('Invalid question route access attempt', { 
        category, 
        slug: req.params.slug,
        ip: req.ip, 
        userAgent: req.get('User-Agent') 
      });
    }
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  // Log valid question access
  if (logger) {
    await logger.info('Question page accessed', { 
      category, 
      slug: req.params.slug,
      ip: req.ip 
    });
  }
  
  res.sendFile(path.join(__dirname, 'public', 'question.html'));
});

// 404 handler for API routes
app.use('/api/*', async (req, res) => {
  if (logger) {
    await logger.warn('API endpoint not found', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  }
  
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: '/api/docs',
    requestId: req.requestId
  });
});

// 404 handler for web routes
app.use(async (req, res) => {
  // Skip logging for common bot/scanner requests
  const skipPaths = [
    '/.well-known/',
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
    '/apple-touch-icon',
    '/android-chrome',
    '/browserconfig.xml',
    '/manifest.json',
    '/.env',
    '/wp-admin',
    '/admin.php',
    '/phpmyadmin'
  ];
  
  const shouldSkipLogging = skipPaths.some(path => req.path.includes(path));
  
  if (!shouldSkipLogging && logger) {
    await logger.warn('Page not found', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  }
  
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Sentry error handler must be before other error handlers - Updated
if (Sentry) {
  try {
    if (Sentry.Handlers && typeof Sentry.Handlers.errorHandler === 'function') {
      // Sentry v7 style - most common and stable
      app.use(Sentry.Handlers.errorHandler());
      console.log('Sentry error handler initialized');
    } else if (typeof Sentry.errorHandler === 'function') {
      // Alternative style
      app.use(Sentry.errorHandler());
      console.log('Sentry error handler (alternative) initialized');
    } else {
      console.warn('Sentry error handler not available');
    }
  } catch (error) {
    console.warn('Failed to setup Sentry error handler:', error.message);
  }
}

// Global error handling middleware with enhanced logging
app.use(async (err, req, res, next) => {
  const errorData = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  };
  
  console.error('Global error handler:', err);
  
  // Log to Redis if available
  if (logger) {
    await logger.error('Application error', errorData);
  }
  
  // Log error to Sentry in production
  if (Sentry && process.env.NODE_ENV === 'production') {
    Sentry.captureException(err, {
      tags: {
        component: 'global_error_handler'
      },
      extra: errorData
    });
  }
  
  // CORS error
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS policy violation',
      message: 'Origin not allowed',
      requestId: req.requestId
    });
  }
  
  // Rate limit error
  if (err.statusCode === 429) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: err.message,
      requestId: req.requestId
    });
  }
  
  // Validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
      requestId: req.requestId
    });
  }
  
  // MongoDB connection error
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    return res.status(503).json({
      error: 'Database error',
      message: 'Service temporarily unavailable',
      requestId: req.requestId
    });
  }
  
  // Default error response
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
    requestId: req.requestId
  });
});

// Enhanced graceful shutdown function with comprehensive logging
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
  if (logger) {
    await logger.info('Graceful shutdown initiated', { signal, serverInstanceId });
  }
  
  let shutdownComplete = false;
  
  // Set a timeout to force shutdown if it takes too long
  const forceShutdownTimer = setTimeout(async () => {
    if (!shutdownComplete) {
      console.error('Graceful shutdown timed out, forcing exit...');
      if (logger) {
        await logger.error('Graceful shutdown timeout', { signal });
      }
      process.exit(1);
    }
  }, 15000); // 15 seconds timeout
  
  try {
    // Stop accepting new connections
    if (server) {
      console.log('Closing HTTP server...');
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('HTTP server closed successfully.');
            resolve();
          }
        });
      });
    }
    
    // Close Redis connection
    if (redisClient && redisClient.isReady) {
      console.log('Closing Redis connection...');
      if (logger) {
        await logger.info('Closing Redis connection');
      }
      await redisClient.quit();
      console.log('Redis connection closed successfully.');
    }
    
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      console.log('Closing MongoDB connection...');
      if (logger) {
        await logger.info('Closing MongoDB connection');
      }
      await mongoose.connection.close();
      console.log('MongoDB connection closed successfully.');
    }
    
    shutdownComplete = true;
    clearTimeout(forceShutdownTimer);
    console.log('Graceful shutdown completed.');
    
    if (logger) {
      await logger.info('Graceful shutdown completed successfully');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    if (logger) {
      await logger.error('Error during graceful shutdown', { error: error.message, signal });
    }
    clearTimeout(forceShutdownTimer);
    process.exit(1);
  }
};

// Database connection with retry logic and enhanced logging
const connectWithRetry = async () => {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db';
  
  console.log('Attempting to connect to MongoDB...');
  
  try {
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    });
    
    console.log('Connected to MongoDB successfully');
    
    if (logger) {
      await logger.info('Connected to MongoDB successfully', { 
        mongoUrl: mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') // Hide credentials
      });
    }
    
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    
    if (logger) {
      await logger.error('MongoDB connection error', { 
        error: error.message,
        mongoUrl: mongoUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')
      });
    }
    
    console.log('Retrying connection in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return connectWithRetry();
  }
};

// MongoDB connection event handlers with logging
mongoose.connection.on('error', async (err) => {
  console.error('MongoDB connection error:', err);
  
  if (logger) {
    await logger.error('MongoDB connection error', { error: err.message });
  }
  
  // Log to Sentry in production
  if (Sentry && process.env.NODE_ENV === 'production') {
    Sentry.captureException(err, {
      tags: { component: 'mongodb' }
    });
  }
});

mongoose.connection.on('disconnected', async () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  
  if (logger) {
    await logger.warn('MongoDB disconnected');
  }
  
  if (!isShuttingDown) {
    setTimeout(connectWithRetry, 5000);
  }
});

mongoose.connection.on('reconnected', async () => {
  console.log('MongoDB reconnected successfully');
  
  if (logger) {
    await logger.info('MongoDB reconnected successfully');
  }
});

// Handle uncaught exceptions with logging
process.on('uncaughtException', async (err) => {
  console.error('Uncaught Exception:', err);
  
  if (logger) {
    await logger.error('Uncaught exception', { 
      error: err.message, 
      stack: err.stack 
    });
  }
  
  // Log to Sentry in production
  if (Sentry && process.env.NODE_ENV === 'production') {
    Sentry.captureException(err, {
      tags: { component: 'uncaught_exception' }
    });
  }
  
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  if (logger) {
    await logger.error('Unhandled rejection', { 
      reason: reason?.message || reason,
      stack: reason?.stack
    });
  }
  
  // Log to Sentry in production
  if (Sentry && process.env.NODE_ENV === 'production') {
    Sentry.captureException(reason, {
      tags: { component: 'unhandled_rejection' }
    });
  }
  
  gracefulShutdown('unhandledRejection');
});

// Enhanced cron jobs for automated tasks with logging - FIXED VERSION
const setupCronJobs = () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Skipping cron jobs in development mode');
    return;
  }

  console.log('Setting up production cron jobs...');

  // Update popularity metrics every hour
  cron.schedule('0 * * * *', async () => {
    console.log('Running scheduled popularity metrics update...');
    
    if (logger) {
      await logger.info('Starting scheduled popularity metrics update');
    }
    
    try {
      await Question.updateAllPopularityMetrics();
      console.log('Popularity metrics updated successfully');
      
      if (logger) {
        await logger.info('Popularity metrics updated successfully');
      }
      
      // Cache popular questions if Redis is available
      if (redisClient && redisClient.isReady) {
        try {
          const popularQuestions = await Question.find({})
            .sort({ popularityScore: -1 })
            .limit(10)
            .lean();
          
          await redisClient.setEx('popular_questions', 3600, JSON.stringify(popularQuestions));
          console.log('Popular questions cached to Redis');
          
          if (logger) {
            await logger.info('Popular questions cached to Redis', { count: popularQuestions.length });
          }
        } catch (cacheError) {
          console.error('Error caching popular questions:', cacheError);
          
          if (logger) {
            await logger.error('Error caching popular questions', { error: cacheError.message });
          }
        }
      }
      
    } catch (error) {
      console.error('Error updating popularity metrics:', error);
      
      if (logger) {
        await logger.error('Error updating popularity metrics', { error: error.message });
      }
      
      // Log to Sentry
      if (Sentry) {
        Sentry.captureException(error, {
          tags: { component: 'cron_popularity_metrics' }
        });
      }
    }
  });
  
  // Clean up old view records (keep last 90 days) - runs daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('Running scheduled cleanup of old view records...');
    
    if (logger) {
      await logger.info('Starting scheduled cleanup of old view records');
    }
    
    try {
      const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
      
      const result = await Question.updateMany(
        {},
        {
          $pull: {
            views: { timestamp: { $lt: cutoffDate } }
          }
        }
      );
      
      console.log(`Cleaned up old view records. Modified ${result.modifiedCount} questions`);
      
      if (logger) {
        await logger.info('Cleaned up old view records', { 
          modifiedCount: result.modifiedCount,
          cutoffDate: cutoffDate.toISOString()
        });
      }
      
      // Clear old cache entries if Redis is available
      if (redisClient && redisClient.isReady) {
        try {
          const keys = await redisClient.keys('question:*');
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`Cleared ${keys.length} cached question entries`);
            
            if (logger) {
              await logger.info('Cleared cached question entries', { count: keys.length });
            }
          }
        } catch (cacheError) {
          console.error('Error clearing cache:', cacheError);
          
          if (logger) {
            await logger.error('Error clearing cache', { error: cacheError.message });
          }
        }
      }
      
    } catch (error) {
      console.error('Error cleaning up old view records:', error);
      
      if (logger) {
        await logger.error('Error cleaning up old view records', { error: error.message });
      }
      
      // Log to Sentry
      if (Sentry) {
        Sentry.captureException(error, {
          tags: { component: 'cron_cleanup' }
        });
      }
    }
  });

  // Health check and metrics collection - runs every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const healthData = {
        timestamp: new Date(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        redis: redisClient && redisClient.isReady ? 'connected' : 'disconnected',
        loadAverage: os.loadavg(),
        performance: app.locals.performanceData || {}
      };

      // Cache health data if Redis is available
      if (redisClient && redisClient.isReady) {
        await redisClient.setEx('health_metrics', 900, JSON.stringify(healthData)); // 15 minutes
      }

      // Log performance metrics in production
      if (process.env.NODE_ENV === 'production') {
        const logMessage = `Health check - Uptime: ${Math.floor(healthData.uptime/3600)}h, Memory: ${(healthData.memory.heapUsed/1024/1024).toFixed(2)}MB, DB: ${healthData.database}, Redis: ${healthData.redis}`;
        console.log(logMessage);
        
        if (logger) {
          await logger.info('Health check completed', healthData);
        }
      }

    } catch (error) {
      console.error('Error in health check cron:', error);
      
      if (logger) {
        await logger.error('Error in health check cron', { error: error.message });
      }
    }
  });

  // Clean up old logs - runs daily at 3 AM - FIXED VERSION
  cron.schedule('0 3 * * *', async () => {
    if (!redisClient || !redisClient.isReady) {
      return;
    }
    
    console.log('Running scheduled log cleanup...');
    
    if (logger) {
      await logger.info('Starting scheduled log cleanup');
    }
    
    try {
      const levels = ['error', 'warn', 'info', 'debug'];
      let totalCleaned = 0;
      
      for (const level of levels) {
        const timelineKey = `logs:timeline:${level}`;
        const count = await redisClient.zCard(timelineKey);
        
        if (count > 1000) {
          // Keep only the most recent 1000 logs
          const removedCount = await redisClient.zRemRangeByRank(timelineKey, 0, count - 1001);
          totalCleaned += removedCount;
        }
      }
      
      // Clean up old log statistics (keep only last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const statsKeys = await redisClient.keys(`logs:stats:*`);
      let statsKeysRemoved = 0;
      
      for (const key of statsKeys) {
        const dateStr = key.split(':')[2];
        const keyDate = new Date(dateStr);
        
        if (keyDate < thirtyDaysAgo) {
          await redisClient.del(key);
          statsKeysRemoved++;
        }
      }
      
      console.log(`Log cleanup completed. Removed ${totalCleaned} log entries and ${statsKeysRemoved} old statistics`);
      
      if (logger) {
        await logger.info('Log cleanup completed', { 
          logEntriesRemoved: totalCleaned,
          statsKeysRemoved 
        });
      }
      
    } catch (error) {
      console.error('Error in log cleanup cron:', error);
      
      if (logger) {
        await logger.error('Error in log cleanup cron', { error: error.message });
      }
    }
  });

  console.log('Cron jobs set up successfully');
  
  if (logger) {
    logger.info('Cron jobs set up successfully');
  }
};

// Start the application
const startServer = async () => {
  try {
    console.log(`Starting Moral Dilemma Server v${process.env.npm_package_version || '1.0.0'}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Server Instance ID: ${serverInstanceId}`);
    
    // Initialize Redis first
    if (process.env.REDIS_URL) {
      redisClient = await initializeRedis();
      rateLimitStore = createRateLimitStore();
    } else {
      console.log('Redis not configured, using memory-based rate limiting');
      // Initialize basic logger without Redis
      logger = new RedisLogger(null);
    }
    
    // Connect to MongoDB
    const dbConnected = await connectWithRetry();
    if (!dbConnected) {
      throw new Error('Failed to connect to MongoDB');
    }
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    
    server = app.listen(PORT)
      .on('listening', async () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🌟 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 API Documentation: http://localhost:${PORT}/api/docs`);
        console.log(`💻 Admin Analytics: http://localhost:${PORT}/admin/analytics`);
        console.log(`📋 Categories page: http://localhost:${PORT}/categories`);
        console.log(`🔥 Trending page: http://localhost:${PORT}/trending`);
        console.log(`ℹ️  About page: http://localhost:${PORT}/about`);
        console.log(`🏥 Health check: http://localhost:${PORT}/health`);
        console.log(`📝 System logs: http://localhost:${PORT}/api/logs`);
        console.log(`📈 System metrics: http://localhost:${PORT}/api/metrics`);
        console.log(`📂 Category pages: http://localhost:${PORT}/category/{category-name}`);
        console.log('✅ Server startup completed successfully');
        
        if (logger) {
          await logger.info('Server started successfully', {
            port: PORT,
            environment: process.env.NODE_ENV || 'development',
            serverInstanceId,
            features: {
              redis: !!redisClient,
              sentry: !!Sentry && !!(process.env.SENTRY_DSN && process.env.NODE_ENV === 'production'),
              logging: true,
              metrics: !!redisClient
            }
          });
        }
        
        // Setup cron jobs after server starts
        setupCronJobs();
      })
      .on('error', async (err) => {
        console.error('❌ Server error:', err);
        
        if (logger) {
          await logger.error('Server startup error', { error: err.message, stack: err.stack });
        }
        
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Port ${PORT} is already in use.`);
          console.error('💡 Solutions:');
          console.error('   1. Kill the process using this port:');
          console.error(`      • Windows: netstat -ano | findstr :${PORT} && taskkill /PID <PID> /F`);
          console.error(`      • macOS/Linux: lsof -ti:${PORT} | xargs kill -9`);
          console.error(`   2. Use a different port: PORT=${PORT + 1} node server.js`);
          console.error('   3. Wait a moment and try again (port might be releasing)');
          process.exit(1);
        } else {
          console.error('❌ Failed to start server:', err.message);
          process.exit(1);
        }
      });
    
    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart
    
    // Windows-specific signals
    if (process.platform === 'win32') {
      require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      }).on('SIGINT', () => {
        process.emit('SIGINT');
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    
    if (logger) {
      await logger.error('Server startup failed', { error: error.message, stack: error.stack });
    }
    
    // Log to Sentry in production
    if (Sentry && process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, {
        tags: { component: 'server_startup' }
      });
    }
    
    process.exit(1);
  }
};

// Start the server
startServer();

// Export app for testing
module.exports = app;