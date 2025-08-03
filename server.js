const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

// Import routes
const questionRoutes = require('./routes/questions');
const subscriberRoutes = require('./routes/subscribers');
const adminRoutes = require('./routes/admin');
const analyticsRoutes = require('./routes/analytics');

// Import models for cron jobs
const Question = require('./models/Question');

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Compression middleware for better performance
app.use(compression());

// Logging middleware
app.use(morgan('combined'));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting with different tiers
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Higher limit for API endpoints
  message: {
    error: 'Too many API requests from this IP, please try again later.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const responseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Limit responses to prevent spam
  message: {
    error: 'Too many responses from this IP, please try again later.',
    retryAfter: 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting
app.use(generalLimiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000'
    ].filter(Boolean);
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Body parsing middleware with size limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Serve static files with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache static files for 1 day
  etag: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes with specific rate limiting
app.use('/api/questions', apiLimiter, questionRoutes);
app.use('/api/subscribers', apiLimiter, subscriberRoutes);
app.use('/api/admin', adminRoutes); // Admin routes should have their own auth-based limiting
app.use('/api/analytics', apiLimiter, analyticsRoutes);

// Apply response rate limiting to response endpoints
app.use('/api/questions/:category/:slug/respond', responseLimiter);

// Serve React app or HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Category page route
app.get('/category/:category', (req, res) => {
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
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Question page route
app.get('/:category/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'question.html'));
});

// Admin routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-analytics.html'));
});

// API documentation route
app.get('/api/docs', (req, res) => {
  const apiDocs = {
    title: 'Moral Dilemma API Documentation',
    version: '2.0.0',
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
      }
    },
    parameters: {
      sortBy: ['popularity', 'trending', 'newest', 'most_responses'],
      questionType: ['all', 'multiple_choice', 'paragraph'],
      timeRange: ['24h', '7d', '30d', 'all'],
      format: ['json', 'csv']
    }
  };
  
  res.json(apiDocs);
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ 
    error: 'API endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: '/api/docs'
  });
});

// 404 handler for web routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  
  // CORS error
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS policy violation',
      message: 'Origin not allowed'
    });
  }
  
  // Rate limit error
  if (err.statusCode === 429) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: err.message
    });
  }
  
  // Validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors
    });
  }
  
  // MongoDB connection error
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    return res.status(503).json({
      error: 'Database error',
      message: 'Service temporarily unavailable'
    });
  }
  
  // Default error response
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
    requestId: req.headers['x-request-id'] || 'unknown'
  });
});

// Database connection with retry logic
const connectWithRetry = () => {
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db';
  
  console.log('Attempting to connect to MongoDB...');
  
  mongoose.connect(mongoUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    bufferCommands: false, // Disable mongoose buffering
    // bufferMaxEntries: 0 - REMOVED: This option is deprecated and not supported
  })
  .then(() => {
    console.log('Connected to MongoDB successfully');
    
    // Start the server only after successful DB connection
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`API Documentation: http://localhost:${PORT}/api/docs`);
    });
    
    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));
    
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

// Graceful shutdown function
const gracefulShutdown = (server) => {
  console.log('Received shutdown signal. Starting graceful shutdown...');
  
  server.close(() => {
    console.log('HTTP server closed.');
    
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// MongoDB connection event handlers
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  connectWithRetry();
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Cron jobs for automated tasks
if (process.env.NODE_ENV === 'production') {
  // Update popularity metrics every hour
  cron.schedule('0 * * * *', async () => {
    console.log('Running scheduled popularity metrics update...');
    try {
      await Question.updateAllPopularityMetrics();
      console.log('Popularity metrics updated successfully');
    } catch (error) {
      console.error('Error updating popularity metrics:', error);
    }
  });
  
  // Clean up old view records (keep last 90 days) - runs daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('Running scheduled cleanup of old view records...');
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
    } catch (error) {
      console.error('Error cleaning up old view records:', error);
    }
  });
}

// Start the connection process
connectWithRetry();

// Export app for testing
module.exports = app;