const mongoose = require('mongoose');

const choiceSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  votes: {
    type: Number,
    default: 0
  }
});

const responseSchema = new mongoose.Schema({
  choice: {
    type: String,
    required: function () {
      return this.parent().questionType === 'multiple_choice';
    }
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: 1000,
    required: function () {
      return this.parent().questionType === 'multiple_choice';
    }
  },
  responseText: {
    type: String,
    trim: true,
    maxlength: 2000,
    required: function () {
      return this.parent().questionType === 'paragraph';
    }
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String,
    required: false // For tracking unique responses
  },
  userAgent: {
    type: String,
    required: false
  }
});

const viewSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    required: false
  },
  sessionId: {
    type: String,
    required: false
  },
  referrer: {
    type: String,
    required: false
  }
});

const popularityMetricsSchema = new mongoose.Schema({
  totalViews: {
    type: Number,
    default: 0
  },
  uniqueViews: {
    type: Number,
    default: 0
  },
  totalResponses: {
    type: Number,
    default: 0
  },
  uniqueResponses: {
    type: Number,
    default: 0
  },
  viewsLast24h: {
    type: Number,
    default: 0
  },
  viewsLast7d: {
    type: Number,
    default: 0
  },
  viewsLast30d: {
    type: Number,
    default: 0
  },
  responsesLast24h: {
    type: Number,
    default: 0
  },
  responsesLast7d: {
    type: Number,
    default: 0
  },
  responsesLast30d: {
    type: Number,
    default: 0
  },
  popularityScore: {
    type: Number,
    default: 0
  },
  trendingScore: {
    type: Number,
    default: 0
  },
  engagementRate: {
    type: Number,
    default: 0
  },
  lastCalculated: {
    type: Date,
    default: Date.now
  }
});

const questionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: [
      'love', 'justice', 'survival', 'family', 'freedom', 'sacrifice',
      'truth', 'loyalty', 'revenge', 'power', 'empathy', 'morality',
      'desire', 'regret', 'identity', 'betrayal', 'hope', 'fear',
      'faith', 'control', 'loss', 'trust', 'responsibility', 'choice',
      'pain', 'greed', 'envy', 'honor', 'duty', 'self'
    ],
    lowercase: true
  },
  questionText: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  questionType: {
    type: String,
    enum: ['multiple_choice', 'paragraph'],
    default: 'multiple_choice',
    required: true
  },
  choices: {
    type: [choiceSchema],
    default: function() {
      return this.questionType === 'multiple_choice' ? [] : undefined;
    },
    validate: {
      validator: function (choices) {
        if (this.questionType === 'multiple_choice') {
          return choices && choices.length >= 2 && choices.length <= 6;
        }
        return !choices || choices.length === 0;
      },
      message: 'Multiple choice questions must have 2-6 choices, paragraph questions should have no choices'
    }
  },
  responses: {
    type: [responseSchema],
    default: []
  },
  views: {
    type: [viewSchema],
    default: []
  },
  popularityMetrics: {
    type: popularityMetricsSchema,
    default: () => ({})
  },
  featured: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  estimatedReadTime: {
    type: Number, // in minutes
    default: 2
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
questionSchema.index({ category: 1, slug: 1 }, { unique: true });
questionSchema.index({ questionType: 1 });
questionSchema.index({ featured: 1, createdAt: -1 });
questionSchema.index({ category: 1, questionType: 1 });
questionSchema.index({ 'popularityMetrics.popularityScore': -1 });
questionSchema.index({ 'popularityMetrics.trendingScore': -1 });
questionSchema.index({ category: 1, 'popularityMetrics.popularityScore': -1 });
questionSchema.index({ createdAt: -1 });
questionSchema.index({ tags: 1 });

// Update timestamp
questionSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Virtual fields
questionSchema.virtual('totalVotes').get(function () {
  if (this.questionType === 'multiple_choice' && this.choices && Array.isArray(this.choices)) {
    return this.choices.reduce((total, choice) => total + (choice.votes || 0), 0);
  }
  return 0;
});

questionSchema.virtual('responseCount').get(function () {
  return this.responses ? this.responses.length : 0;
});

questionSchema.virtual('viewCount').get(function () {
  return this.views ? this.views.length : 0;
});

// Method to record a view
questionSchema.methods.recordView = function(ipAddress, userAgent = '', sessionId = '', referrer = '') {
  if (!this.views) this.views = [];
  
  this.views.push({
    timestamp: new Date(),
    ipAddress,
    userAgent,
    sessionId,
    referrer
  });
  
  return this.save();
};

// Method to add response with tracking
questionSchema.methods.addMultipleChoiceResponse = function (choiceText, explanation, ipAddress = '', userAgent = '') {
  if (this.questionType !== 'multiple_choice') {
    throw new Error('Cannot add multiple choice response to paragraph question');
  }

  if (!this.responses) this.responses = [];

  this.responses.push({
    choice: choiceText,
    explanation: explanation,
    timestamp: new Date(),
    createdAt: new Date(),
    ipAddress,
    userAgent
  });

  if (this.choices && Array.isArray(this.choices)) {
    const choice = this.choices.find(c => c.text === choiceText);
    if (choice) {
      choice.votes = (choice.votes || 0) + 1;
    }
  }

  return this.save();
};

questionSchema.methods.addParagraphResponse = function (responseText, explanation = '', ipAddress = '', userAgent = '') {
  if (this.questionType !== 'paragraph') {
    throw new Error('Cannot add paragraph response to multiple choice question');
  }

  if (!this.responses) this.responses = [];

  const responseData = {
    responseText: responseText,
    timestamp: new Date(),
    createdAt: new Date(),
    ipAddress,
    userAgent
  };

  if (explanation && explanation.trim() !== '') {
    responseData.explanation = explanation;
  }

  this.responses.push(responseData);
  return this.save();
};

// Method to calculate popularity metrics
questionSchema.methods.calculatePopularityMetrics = function() {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const week = 7 * day;
  const month = 30 * day;

  // Count views in different time periods
  const viewsLast24h = this.views.filter(view => 
    now - new Date(view.timestamp) <= day
  ).length;
  
  const viewsLast7d = this.views.filter(view => 
    now - new Date(view.timestamp) <= week
  ).length;
  
  const viewsLast30d = this.views.filter(view => 
    now - new Date(view.timestamp) <= month
  ).length;

  // Count responses in different time periods
  const responsesLast24h = this.responses.filter(response => 
    now - new Date(response.timestamp) <= day
  ).length;
  
  const responsesLast7d = this.responses.filter(response => 
    now - new Date(response.timestamp) <= week
  ).length;
  
  const responsesLast30d = this.responses.filter(response => 
    now - new Date(response.timestamp) <= month
  ).length;

  // Calculate unique views (based on IP address)
  const uniqueViewIPs = new Set(this.views.map(view => view.ipAddress));
  const uniqueResponseIPs = new Set(this.responses.map(response => response.ipAddress));

  // Calculate engagement rate (responses/views ratio)
  const engagementRate = this.views.length > 0 ? 
    (this.responses.length / this.views.length) * 100 : 0;

  // Calculate popularity score (weighted algorithm)
  const ageInDays = (now - this.createdAt) / day;
  const ageFactor = Math.max(0.1, 1 / (1 + ageInDays * 0.1)); // Newer questions get slight boost
  
  const popularityScore = (
    (viewsLast7d * 2) +           // Recent views weight more
    (responsesLast7d * 5) +       // Responses weight much more
    (uniqueViewIPs.size * 1.5) +  // Unique engagement
    (engagementRate * 0.5) +      // Engagement quality
    (this.featured ? 10 : 0)      // Featured boost
  ) * ageFactor;

  // Calculate trending score (recent activity focus)
  const trendingScore = (
    (viewsLast24h * 5) +
    (responsesLast24h * 10) +
    (viewsLast7d * 2) +
    (responsesLast7d * 4)
  );

  // Update metrics
  this.popularityMetrics = {
    totalViews: this.views.length,
    uniqueViews: uniqueViewIPs.size,
    totalResponses: this.responses.length,
    uniqueResponses: uniqueResponseIPs.size,
    viewsLast24h,
    viewsLast7d,
    viewsLast30d,
    responsesLast24h,
    responsesLast7d,
    responsesLast30d,
    popularityScore: Math.round(popularityScore * 100) / 100,
    trendingScore: Math.round(trendingScore * 100) / 100,
    engagementRate: Math.round(engagementRate * 100) / 100,
    lastCalculated: now
  };

  return this.save();
};

// Static method to update all popularity metrics
questionSchema.statics.updateAllPopularityMetrics = async function() {
  const questions = await this.find({});
  const promises = questions.map(question => question.calculatePopularityMetrics());
  return Promise.all(promises);
};

// FIXED: Find question by category and slug
questionSchema.statics.findByCategoryAndSlug = function(category, slug) {
  return this.findOne({ 
    category: category.toLowerCase(), 
    slug: slug.toLowerCase() 
  });
};

// FIXED: Get latest questions
questionSchema.statics.getLatest = function(limit = 10) {
  return this.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('title slug category questionText questionType createdAt featured popularityMetrics tags difficulty estimatedReadTime');
};

// FIXED: Get featured questions
questionSchema.statics.getFeatured = function(limit = 10) {
  return this.find({ featured: true })
    .sort({ 'popularityMetrics.popularityScore': -1, createdAt: -1 })
    .limit(limit)
    .select('title slug category questionText questionType createdAt featured popularityMetrics tags difficulty estimatedReadTime');
};

// FIXED: Static method to get questions by category with sorting options
questionSchema.statics.getByCategory = function(category, options = {}) {
  const {
    sortBy = 'popularity', // 'popularity', 'trending', 'newest', 'most_responses'
    questionType = 'all',   // 'all', 'multiple_choice', 'paragraph'
    limit = 20,
    page = 1,
    featured = false
  } = options;

  let query = { category: category.toLowerCase() };
  
  if (questionType !== 'all') {
    query.questionType = questionType;
  }
  
  if (featured) {
    query.featured = true;
  }

  let sortOptions = {};
  switch (sortBy) {
    case 'trending':
      sortOptions = { 'popularityMetrics.trendingScore': -1, createdAt: -1 };
      break;
    case 'newest':
      sortOptions = { createdAt: -1 };
      break;
    case 'most_responses':
      sortOptions = { 'popularityMetrics.totalResponses': -1, createdAt: -1 };
      break;
    case 'popularity':
    default:
      sortOptions = { 'popularityMetrics.popularityScore': -1, createdAt: -1 };
      break;
  }

  const skip = (page - 1) * limit;

  return this.find(query)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .select('title slug category questionText questionType createdAt featured popularityMetrics tags difficulty estimatedReadTime choices responses views');
};

// FIXED: Static method to get category statistics
questionSchema.statics.getCategoryStats = async function(category) {
  const totalQuestions = await this.countDocuments({ category: category.toLowerCase() });
  const multipleChoiceCount = await this.countDocuments({ 
    category: category.toLowerCase(), 
    questionType: 'multiple_choice' 
  });
  const paragraphCount = await this.countDocuments({ 
    category: category.toLowerCase(), 
    questionType: 'paragraph' 
  });

  const popularityAgg = await this.aggregate([
    { $match: { category: category.toLowerCase() } },
    {
      $group: {
        _id: null,
        avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
        totalViews: { $sum: '$popularityMetrics.totalViews' },
        totalResponses: { $sum: '$popularityMetrics.totalResponses' },
        avgEngagement: { $avg: '$popularityMetrics.engagementRate' }
      }
    }
  ]);

  const stats = popularityAgg[0] || {
    avgPopularity: 0,
    totalViews: 0,
    totalResponses: 0,
    avgEngagement: 0
  };

  return {
    totalQuestions,
    multipleChoiceCount,
    paragraphCount,
    avgPopularityScore: Math.round(stats.avgPopularity * 100) / 100,
    totalViews: stats.totalViews,
    totalResponses: stats.totalResponses,
    avgEngagementRate: Math.round(stats.avgEngagement * 100) / 100
  };
};

// FIXED: Static method to get trending questions across all categories
questionSchema.statics.getTrending = function(limit = 10) {
  return this.find({})
    .sort({ 'popularityMetrics.trendingScore': -1 })
    .limit(limit)
    .select('title slug category questionText questionType createdAt popularityMetrics tags difficulty estimatedReadTime');
};

// FIXED: Static method to get most popular questions across all categories
questionSchema.statics.getMostPopular = function(limit = 10) {
  return this.find({})
    .sort({ 'popularityMetrics.popularityScore': -1 })
    .limit(limit)
    .select('title slug category questionText questionType createdAt popularityMetrics tags difficulty estimatedReadTime');
};

// Enhanced toJSON method
questionSchema.methods.toJSON = function () {
  const obj = this.toObject();
  
  obj.totalVotes = this.totalVotes;
  obj.responseCount = this.responseCount;
  obj.viewCount = this.viewCount;

  if (this.questionType === 'paragraph' && (!obj.choices || obj.choices.length === 0)) {
    delete obj.choices;
  }

  // Don't expose raw views and detailed response data in list views
  delete obj.views;
  if (obj.responses) {
    delete obj.responses;
  }

  return obj;
};

module.exports = mongoose.model('Question', questionSchema);