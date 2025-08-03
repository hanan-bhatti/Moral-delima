const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Joi = require('joi');

// Validation schemas
const multipleChoiceResponseSchema = Joi.object({
  choice: Joi.string().required(),
  explanation: Joi.string().min(10).max(1000).required()
});

const paragraphResponseSchema = Joi.object({
  responseText: Joi.string().min(20).max(2000).required(),
  explanation: Joi.string().max(1000).allow('').optional()
});

const categoryParamSchema = Joi.object({
  category: Joi.string().valid(
    'love', 'justice', 'survival', 'family', 'freedom', 'sacrifice',
    'truth', 'loyalty', 'revenge', 'power', 'empathy', 'morality',
    'desire', 'regret', 'identity', 'betrayal', 'hope', 'fear',
    'faith', 'control', 'loss', 'trust', 'responsibility', 'choice',
    'pain', 'greed', 'envy', 'honor', 'duty', 'self'
  ).required()
});

// Helper function to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         '127.0.0.1';
};

// GET /api/questions - Get latest questions (for homepage)
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    const featured = req.query.featured === 'true';
    const sortBy = req.query.sortBy || 'newest'; // 'newest', 'popular', 'trending'
    
    let questions;
    
    if (featured) {
      questions = await Question.getFeatured(limit);
    } else {
      switch (sortBy) {
        case 'popular':
          questions = await Question.getMostPopular(limit);
          break;
        case 'trending':
          questions = await Question.getTrending(limit);
          break;
        case 'newest':
        default:
          questions = await Question.getLatest(limit);
          break;
      }
    }
    
    res.json({
      success: true,
      data: questions,
      count: questions.length,
      sortBy
    });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch questions'
    });
  }
});

// GET /api/questions/categories - Get all categories with statistics
router.get('/categories', async (req, res) => {
  try {
    const includeStats = req.query.includeStats === 'true';
    
    const categories = await Question.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          latestQuestion: { $max: '$createdAt' },
          avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
          totalViews: { $sum: '$popularityMetrics.totalViews' },
          totalResponses: { $sum: '$popularityMetrics.totalResponses' },
          multipleChoiceCount: {
            $sum: { $cond: [{ $eq: ['$questionType', 'multiple_choice'] }, 1, 0] }
          },
          paragraphCount: {
            $sum: { $cond: [{ $eq: ['$questionType', 'paragraph'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { avgPopularity: -1, count: -1 }
      }
    ]);
    
    const formattedCategories = categories.map(cat => {
      const result = {
        name: cat._id,
        count: cat.count,
        latestQuestion: cat.latestQuestion
      };
      
      if (includeStats) {
        result.stats = {
          avgPopularityScore: Math.round(cat.avgPopularity * 100) / 100 || 0,
          totalViews: cat.totalViews || 0,
          totalResponses: cat.totalResponses || 0,
          multipleChoiceCount: cat.multipleChoiceCount || 0,
          paragraphCount: cat.paragraphCount || 0
        };
      }
      
      return result;
    });
    
    res.json({
      success: true,
      data: formattedCategories,
      count: formattedCategories.length
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

// GET /api/questions/category/:category - Get questions by category with advanced filtering
router.get('/category/:category', async (req, res) => {
  try {
    // Validate category parameter
    const { error: paramError } = categoryParamSchema.validate(req.params);
    if (paramError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category'
      });
    }

    const { category } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50); // Max 50 per page
    const sortBy = req.query.sortBy || 'popularity'; // 'popularity', 'trending', 'newest', 'most_responses'
    const questionType = req.query.type || 'all'; // 'all', 'multiple_choice', 'paragraph'
    const featured = req.query.featured === 'true';

    // Get questions with filtering and sorting
    const questions = await Question.getByCategory(category, {
      sortBy,
      questionType,
      limit,
      page,
      featured
    });

    // Get total count for pagination
    let countQuery = { category: category.toLowerCase() };
    if (questionType !== 'all') {
      countQuery.questionType = questionType;
    }
    if (featured) {
      countQuery.featured = true;
    }
    
    const totalQuestions = await Question.countDocuments(countQuery);
    const totalPages = Math.ceil(totalQuestions / limit);

    // Get category statistics
    const categoryStats = await Question.getCategoryStats(category);

    res.json({
      success: true,
      data: {
        questions,
        pagination: {
          currentPage: page,
          totalPages,
          totalQuestions,
          questionsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        filters: {
          category,
          sortBy,
          questionType,
          featured
        },
        categoryStats
      }
    });
  } catch (error) {
    console.error('Error fetching category questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category questions'
    });
  }
});

// GET /api/questions/:category/:slug - Get specific question with view tracking
router.get('/:category/:slug', async (req, res) => {
  try {
    const { category, slug } = req.params;
    const trackView = req.query.trackView !== 'false'; // Default to true
    
    // FIXED: Use findByCategoryAndSlug method
    const question = await Question.findByCategoryAndSlug(category, slug);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    // Track view if enabled
    if (trackView) {
      const clientIP = getClientIP(req);
      const userAgent = req.headers['user-agent'] || '';
      const sessionId = req.headers['x-session-id'] || '';
      const referrer = req.headers['referer'] || '';

      try {
        await question.recordView(clientIP, userAgent, sessionId, referrer);
        // Update popularity metrics asynchronously
        question.calculatePopularityMetrics().catch(err => 
          console.error('Error calculating popularity metrics:', err)
        );
      } catch (viewError) {
        console.error('Error recording view:', viewError);
        // Continue with response even if view tracking fails
      }
    }
    
    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch question'
    });
  }
});

// POST /api/questions/:category/:slug/respond - Add response to question
router.post('/:category/:slug/respond', async (req, res) => {
  try {
    const { category, slug } = req.params;
    
    // FIXED: Use findByCategoryAndSlug method
    const question = await Question.findByCategoryAndSlug(category, slug);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    const clientIP = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';

    let validationResult;
    
    if (question.questionType === 'multiple_choice') {
      validationResult = multipleChoiceResponseSchema.validate(req.body);
      
      if (validationResult.error) {
        return res.status(400).json({
          success: false,
          error: validationResult.error.details[0].message
        });
      }
      
      const { choice, explanation } = validationResult.value;
      
      // Verify choice exists
      const validChoice = question.choices.find(c => c.text === choice);
      if (!validChoice) {
        return res.status(400).json({
          success: false,
          error: 'Invalid choice'
        });
      }
      
      await question.addMultipleChoiceResponse(choice, explanation, clientIP, userAgent);
      
      // Update popularity metrics asynchronously
      question.calculatePopularityMetrics().catch(err => 
        console.error('Error calculating popularity metrics:', err)
      );
      
      res.json({
        success: true,
        message: 'Response added successfully',
        data: {
          totalVotes: question.totalVotes,
          choices: question.choices,
          responseCount: question.responseCount
        }
      });
      
    } else if (question.questionType === 'paragraph') {
      validationResult = paragraphResponseSchema.validate(req.body);
      
      if (validationResult.error) {
        return res.status(400).json({
          success: false,
          error: validationResult.error.details[0].message
        });
      }
      
      const { responseText, explanation } = validationResult.value;
      
      await question.addParagraphResponse(responseText, explanation || '', clientIP, userAgent);
      
      // Update popularity metrics asynchronously
      question.calculatePopularityMetrics().catch(err => 
        console.error('Error calculating popularity metrics:', err)
      );
      
      res.json({
        success: true,
        message: 'Response added successfully',
        data: {
          responseCount: question.responseCount
        }
      });
      
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid question type'
      });
    }
    
  } catch (error) {
    console.error('Error adding response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add response'
    });
  }
});

// GET /api/questions/:category/:slug/responses - Get responses for a question
router.get('/:category/:slug/responses', async (req, res) => {
  try {
    const { category, slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const sortBy = req.query.sortBy || 'newest'; // 'newest', 'oldest'
    const skip = (page - 1) * limit;
    
    // FIXED: Use findByCategoryAndSlug method
    const question = await Question.findByCategoryAndSlug(category, slug);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }
    
    // Sort responses
    let sortedResponses = [...question.responses];
    if (sortBy === 'oldest') {
      sortedResponses.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else {
      sortedResponses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
    
    // Apply pagination
    const responses = sortedResponses.slice(skip, skip + limit);
    
    // Remove sensitive data
    const sanitizedResponses = responses.map(response => ({
      choice: response.choice,
      explanation: response.explanation,
      responseText: response.responseText,
      timestamp: response.timestamp,
      createdAt: response.createdAt
    }));
    
    res.json({
      success: true,
      data: {
        responses: sanitizedResponses,
        pagination: {
          totalResponses: question.responses.length,
          currentPage: page,
          totalPages: Math.ceil(question.responses.length / limit),
          responsesPerPage: limit,
          hasNextPage: page < Math.ceil(question.responses.length / limit),
          hasPrevPage: page > 1
        },
        sortBy
      }
    });
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch responses'
    });
  }
});

// GET /api/questions/trending - Get trending questions
router.get('/trending', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const category = req.query.category;
    
    let questions;
    
    if (category) {
      // Validate category if provided
      const { error: paramError } = categoryParamSchema.validate({ category });
      if (paramError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category'
        });
      }
      
      questions = await Question.getByCategory(category, {
        sortBy: 'trending',
        limit
      });
    } else {
      questions = await Question.getTrending(limit);
    }
    
    res.json({
      success: true,
      data: questions,
      count: questions.length,
      category: category || 'all'
    });
  } catch (error) {
    console.error('Error fetching trending questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trending questions'
    });
  }
});

// GET /api/questions/popular - Get most popular questions
router.get('/popular', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const category = req.query.category;
    
    let questions;
    
    if (category) {
      // Validate category if provided
      const { error: paramError } = categoryParamSchema.validate({ category });
      if (paramError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category'
        });
      }
      
      questions = await Question.getByCategory(category, {
        sortBy: 'popularity',
        limit
      });
    } else {
      questions = await Question.getMostPopular(limit);
    }
    
    res.json({
      success: true,
      data: questions,
      count: questions.length,
      category: category || 'all'
    });
  } catch (error) {
    console.error('Error fetching popular questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch popular questions'
    });
  }
});

// GET /api/questions/stats - Get overall statistics
router.get('/stats', async (req, res) => {
  try {
    const totalQuestions = await Question.countDocuments({});
    const totalMultipleChoice = await Question.countDocuments({ questionType: 'multiple_choice' });
    const totalParagraph = await Question.countDocuments({ questionType: 'paragraph' });
    const totalFeatured = await Question.countDocuments({ featured: true });
    
    // Get aggregated statistics
    const aggregatedStats = await Question.aggregate([
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$popularityMetrics.totalViews' },
          totalResponses: { $sum: '$popularityMetrics.totalResponses' },
          avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
          avgEngagement: { $avg: '$popularityMetrics.engagementRate' },
          totalUniqueViews: { $sum: '$popularityMetrics.uniqueViews' },
          totalUniqueResponses: { $sum: '$popularityMetrics.uniqueResponses' }
        }
      }
    ]);
    
    const stats = aggregatedStats[0] || {
      totalViews: 0,
      totalResponses: 0,
      avgPopularity: 0,
      avgEngagement: 0,
      totalUniqueViews: 0,
      totalUniqueResponses: 0
    };
    
    // Get top categories by popularity
    const topCategories = await Question.aggregate([
      {
        $group: {
          _id: '$category',
          avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
          totalQuestions: { $sum: 1 },
          totalViews: { $sum: '$popularityMetrics.totalViews' },
          totalResponses: { $sum: '$popularityMetrics.totalResponses' }
        }
      },
      {
        $sort: { avgPopularity: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    res.json({
      success: true,
      data: {
        overview: {
          totalQuestions,
          totalMultipleChoice,
          totalParagraph,
          totalFeatured,
          totalViews: stats.totalViews,
          totalResponses: stats.totalResponses,
          totalUniqueViews: stats.totalUniqueViews,
          totalUniqueResponses: stats.totalUniqueResponses,
          avgPopularityScore: Math.round(stats.avgPopularity * 100) / 100,
          avgEngagementRate: Math.round(stats.avgEngagement * 100) / 100
        },
        topCategories: topCategories.map(cat => ({
          category: cat._id,
          avgPopularityScore: Math.round(cat.avgPopularity * 100) / 100,
          totalQuestions: cat.totalQuestions,
          totalViews: cat.totalViews,
          totalResponses: cat.totalResponses
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

// POST /api/questions/update-metrics - Manually trigger popularity metrics update
router.post('/update-metrics', async (req, res) => {
  try {
    const category = req.query.category;
    const questionId = req.query.questionId;
    
    if (questionId) {
      // Update specific question
      const question = await Question.findById(questionId);
      if (!question) {
        return res.status(404).json({
          success: false,
          error: 'Question not found'
        });
      }
      
      await question.calculatePopularityMetrics();
      
      res.json({
        success: true,
        message: 'Metrics updated for specific question',
        questionId
      });
    } else if (category) {
      // Update all questions in category
      const { error: paramError } = categoryParamSchema.validate({ category });
      if (paramError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category'
        });
      }
      
      const questions = await Question.find({ category: category.toLowerCase() });
      const promises = questions.map(question => question.calculatePopularityMetrics());
      await Promise.all(promises);
      
      res.json({
        success: true,
        message: `Metrics updated for ${questions.length} questions in category: ${category}`,
        updatedCount: questions.length
      });
    } else {
      // Update all questions
      await Question.updateAllPopularityMetrics();
      
      const totalQuestions = await Question.countDocuments({});
      
      res.json({
        success: true,
        message: 'Metrics updated for all questions',
        updatedCount: totalQuestions
      });
    }
  } catch (error) {
    console.error('Error updating metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update metrics'
    });
  }
});

// GET /api/questions/search - Search questions
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const category = req.query.category;
    const questionType = req.query.type || 'all';
    const sortBy = req.query.sortBy || 'popularity';
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters long'
      });
    }
    
    // Build search criteria
    let searchCriteria = {
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { questionText: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } }
      ]
    };
    
    if (category) {
      const { error: paramError } = categoryParamSchema.validate({ category });
      if (paramError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid category'
        });
      }
      searchCriteria.category = category.toLowerCase();
    }
    
    if (questionType !== 'all') {
      searchCriteria.questionType = questionType;
    }
    
    // Determine sort options
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
    
    // Execute search
    const questions = await Question.find(searchCriteria)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .select('title slug category questionText questionType createdAt featured popularityMetrics tags difficulty estimatedReadTime');
    
    const totalResults = await Question.countDocuments(searchCriteria);
    const totalPages = Math.ceil(totalResults / limit);
    
    res.json({
      success: true,
      data: {
        questions,
        pagination: {
          currentPage: page,
          totalPages,
          totalResults,
          resultsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        searchParams: {
          query,
          category: category || 'all',
          questionType,
          sortBy
        }
      }
    });
  } catch (error) {
    console.error('Error searching questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search questions'
    });
  }
});

module.exports = router;