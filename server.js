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
let server;

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

// Health check endpoint - returns HTML
app.get('/health', (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  };

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
      <title>Health Check</title>
      <style>
        body { 
          font-family: system-ui, sans-serif; 
          margin: 2rem; 
          background: #f5f5f5; 
        }
        .container { 
          max-width: 600px; 
          background: white; 
          padding: 2rem; 
          border-radius: 8px; 
          box-shadow: 0 2px 8px rgba(0,0,0,0.1); 
        }
        .status { 
          background: #22c55e; 
          color: white; 
          padding: 0.5rem 1rem; 
          border-radius: 4px; 
          display: inline-block; 
          margin-bottom: 1rem; 
        }
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
          margin-top: 1rem; 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="status">${healthData.status}</div>
        <h1>System Health</h1>
        
        <div class="info">
          <h3>System Info</h3>
          <div class="row">
            <span class="label">Status:</span>
            <span class="value">${healthData.status}</span>
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

        <div class="info">
          <h3>Memory Usage</h3>
          <div class="row">
            <span class="label">RSS:</span>
            <span class="value">${memoryFormatted.rss}</span>
          </div>
          <div class="row">
            <span class="label">Heap Total:</span>
            <span class="value">${memoryFormatted.heapTotal}</span>
          </div>
          <div class="row">
            <span class="label">Heap Used:</span>
            <span class="value">${memoryFormatted.heapUsed}</span>
          </div>
          <div class="row">
            <span class="label">External:</span>
            <span class="value">${memoryFormatted.external}</span>
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
      </div>

      <script>
        document.getElementById('refreshBtn').addEventListener('click', function() {
          window.location.reload();
        });
      </script>
    </body>
    </html>
  `;

  res.send(html);
});

// API documentation route - returns HTML
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
          margin-top: 1.5rem;
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
          <div class="version">Version ${apiDocs.version}</div>
        </div>
        
        <div class="content">
          <input type="text" class="search-box" id="searchBox" placeholder="Search endpoints...">
          
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
        </div>
      </div>

      <script>
        document.getElementById('searchBox').addEventListener('keyup', function(e) {
          const query = e.target.value.toLowerCase();
          const endpoints = document.querySelectorAll('.endpoint');
          const groups = document.querySelectorAll('.endpoint-group');
          
          if (!query) {
            endpoints.forEach(ep => ep.classList.remove('hidden'));
            groups.forEach(group => group.classList.remove('hidden'));
            return;
          }
          
          groups.forEach(group => {
            const groupEndpoints = group.querySelectorAll('.endpoint');
            let hasVisibleEndpoints = false;
            
            groupEndpoints.forEach(endpoint => {
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
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  // Serve the category HTML file - the frontend will fetch data via API
  res.sendFile(path.join(__dirname, 'public', 'category.html'));
});

// Question page route - MUST BE LAST DYNAMIC ROUTE
app.get('/:category/:slug', (req, res) => {
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
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  
  res.sendFile(path.join(__dirname, 'public', 'question.html'));
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

// Enhanced graceful shutdown function
const gracefulShutdown = (signal) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  
  let shutdownComplete = false;
  
  // Set a timeout to force shutdown if it takes too long
  const forceShutdownTimer = setTimeout(() => {
    if (!shutdownComplete) {
      console.error('Graceful shutdown timed out, forcing exit...');
      process.exit(1);
    }
  }, 10000); // 10 seconds timeout
  
  if (server) {
    server.close((err) => {
      if (err) {
        console.error('Error closing HTTP server:', err);
      } else {
        console.log('HTTP server closed successfully.');
      }
      
      // Close database connection
      mongoose.connection.close(false, (err) => {
        if (err) {
          console.error('Error closing MongoDB connection:', err);
        } else {
          console.log('MongoDB connection closed successfully.');
        }
        
        shutdownComplete = true;
        clearTimeout(forceShutdownTimer);
        console.log('Graceful shutdown completed.');
        process.exit(0);
      });
    });
  } else {
    shutdownComplete = true;
    clearTimeout(forceShutdownTimer);
    process.exit(0);
  }
};

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
  })
  .then(() => {
    console.log('Connected to MongoDB successfully');
    
    // Start the server only after successful DB connection
    const PORT = process.env.PORT || 3000;
    
    // Handle port already in use error
    server = app.listen(PORT, (err) => {
      if (err) {
        console.error('Failed to start server:', err);
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use. Please:`);
          console.error(`1. Kill the process using port ${PORT}:`);
          console.error(`   - Windows: netstat -ano | findstr :${PORT} then taskkill /PID <PID> /F`);
          console.error(`   - macOS/Linux: lsof -ti:${PORT} | xargs kill -9`);
          console.error(`2. Or use a different port: PORT=3001 node server.js`);
        }
        process.exit(1);
      }
      
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`API Documentation: http://localhost:${PORT}/api/docs`);
      console.log(`Admin Analytics: http://localhost:${PORT}/admin/analytics`);
      console.log(`Categories page: http://localhost:${PORT}/categories`);
      console.log(`Trending page: http://localhost:${PORT}/trending`);
      console.log(`About page: http://localhost:${PORT}/about`);
      console.log(`Category pages available at: http://localhost:${PORT}/category/{category-name}`);
    });
    
    // Handle server errors
    server.on('error', (err) => {
      console.error('Server error:', err);
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Trying to find an available port...`);
        // Try next port
        server.listen(PORT + 1);
      }
    });
    
    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart
    
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

// MongoDB connection event handlers
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  setTimeout(connectWithRetry, 5000);
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected successfully');
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
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