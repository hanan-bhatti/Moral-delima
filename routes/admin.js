const express = require('express');
const router = express.Router();
const Question = require('../models/Question');
const Subscriber = require('../models/Subscriber');
const emailService = require('../services/emailService');
const slugify = require('slugify');
const Joi = require('joi');

// Middleware to verify admin access
const verifyAdmin = (req, res, next) => {
  const adminSecret = req.headers['x-admin-secret'] || req.body.adminSecret;

  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid admin credentials'
    });
  }

  next();
};

// Validation schema for new questions - supports both multiple choice and paragraph types
const questionSchema = Joi.object({
  title: Joi.string().min(5).max(200).required(),
  category: Joi.string().valid(
    'love',
    'justice',
    'survival',
    'family',
    'freedom',
    'sacrifice',
    'truth',
    'loyalty',
    'revenge',
    'power',
    'empathy',
    'morality',
    'desire',
    'regret',
    'identity',
    'betrayal',
    'hope',
    'fear',
    'faith',
    'control',
    'loss',
    'trust',
    'responsibility',
    'choice',
    'pain',
    'greed',
    'envy',
    'honor',
    'duty',
    'self'
  ).required(),
  questionText: Joi.string().min(10).max(2000).required(),
  questionType: Joi.string().valid('multiple_choice', 'paragraph').default('multiple_choice'),
  choices: Joi.when('questionType', {
    is: 'multiple_choice',
    then: Joi.array().items(
      Joi.object({
        text: Joi.string().min(1).max(500).required()
      })
    ).min(2).max(6).required(),
    otherwise: Joi.forbidden()
  }),
  featured: Joi.boolean().default(false),
  adminSecret: Joi.string().required()
});

// POST /api/admin/questions - Create new question (supports both types)
router.post('/questions', verifyAdmin, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = questionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    const { title, category, questionText, questionType, choices, featured } = value;

    // Generate slug
    let baseSlug = slugify(title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    // Ensure slug is unique within category
    while (await Question.findOne({ category, slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Create question object based on type
    const questionData = {
      title,
      slug,
      category,
      questionText,
      questionType: questionType || 'multiple_choice',
      featured: featured || false
    };

    // Add choices only for multiple choice questions
    if (questionType === 'multiple_choice' && choices) {
      questionData.choices = choices.map(choice => ({ text: choice.text, votes: 0 }));
    } else {
      // For paragraph questions, initialize empty responses array
      questionData.choices = [];
    }

    const question = new Question(questionData);
    await question.save();

    // Send notification emails to subscribers
    try {
      await emailService.notifySubscribers(question);
    } catch (emailError) {
      console.error('Failed to send notification emails:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: {
        id: question._id,
        slug: question.slug,
        category: question.category,
        questionType: question.questionType,
        url: `/${question.category}/${question.slug}`
      }
    });
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create question'
    });
  }
});

// GET /api/admin/questions - Get all questions with admin details
router.get('/questions', verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const questionType = req.query.type; // Filter by question type if provided

    let filter = {};
    if (questionType && ['multiple_choice', 'paragraph'].includes(questionType)) {
      filter.questionType = questionType;
    }

    const questions = await Question.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('title slug category questionType featured createdAt responses');

    const total = await Question.countDocuments(filter);

    const questionsWithStats = questions.map(q => ({
      _id: q._id,
      title: q.title,
      slug: q.slug,
      category: q.category,
      questionType: q.questionType || 'multiple_choice',
      featured: q.featured,
      createdAt: q.createdAt,
      responseCount: q.responses.length,
      url: `/${q.category}/${q.slug}`
    }));

    res.json({
      success: true,
      data: {
        questions: questionsWithStats,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalQuestions: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching admin questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch questions'
    });
  }
});

// PUT /api/admin/questions/:id/featured - Toggle featured status
router.put('/questions/:id/featured', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    question.featured = featured;
    await question.save();

    res.json({
      success: true,
      message: `Question ${featured ? 'featured' : 'unfeatured'} successfully`,
      data: { featured: question.featured }
    });
  } catch (error) {
    console.error('Error updating featured status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update question'
    });
  }
});

// DELETE /api/admin/questions/:id - Delete question
router.delete('/questions/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const question = await Question.findByIdAndDelete(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }

    res.json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete question'
    });
  }
});

// GET /api/admin/dashboard - Get dashboard statistics
router.get('/dashboard', verifyAdmin, async (req, res) => {
  try {
    const totalQuestions = await Question.countDocuments();
    const featuredQuestions = await Question.countDocuments({ featured: true });
    const multipleChoiceQuestions = await Question.countDocuments({ questionType: 'multiple_choice' });
    const paragraphQuestions = await Question.countDocuments({ questionType: 'paragraph' });
    const totalSubscribers = await Subscriber.countDocuments({ isActive: true });

    // Get questions by category
    const categoryStats = await Question.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalResponses: { $sum: { $size: '$responses' } }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get question type stats
    const questionTypeStats = await Question.aggregate([
      {
        $group: {
          _id: '$questionType',
          count: { $sum: 1 },
          totalResponses: { $sum: { $size: '$responses' } }
        }
      }
    ]);

    // Get recent activity
    const recentQuestions = await Question.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title category questionType createdAt responses');

    const recentSubscribers = await Subscriber.countDocuments({
      subscribedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      isActive: true
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalQuestions,
          featuredQuestions,
          multipleChoiceQuestions,
          paragraphQuestions,
          totalSubscribers,
          recentSubscribers
        },
        categoryStats,
        questionTypeStats,
        recentQuestions: recentQuestions.map(q => ({
          title: q.title,
          category: q.category,
          questionType: q.questionType || 'multiple_choice',
          createdAt: q.createdAt,
          responseCount: q.responses.length
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

// GET /api/admin/questions/search - Search questions
router.get('/questions/search', verifyAdmin, async (req, res) => {
  try {
    const { q, type } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const searchRegex = new RegExp(q.trim(), 'i');
    let filter = {
      $or: [
        { title: searchRegex },
        { questionText: searchRegex },
        { category: searchRegex }
      ]
    };

    // Add question type filter if provided
    if (type && ['multiple_choice', 'paragraph'].includes(type)) {
      filter.questionType = type;
    }

    const questions = await Question.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select('title slug category questionType featured createdAt responses');

    const questionsWithStats = questions.map(q => ({
      _id: q._id,
      title: q.title,
      slug: q.slug,
      category: q.category,
      questionType: q.questionType || 'multiple_choice',
      featured: q.featured,
      createdAt: q.createdAt,
      responseCount: q.responses.length,
      url: `/${q.category}/${q.slug}`
    }));

    res.json({
      success: true,
      data: {
        questions: questionsWithStats,
        total: questionsWithStats.length
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

// GET /api/admin/subscribers - Get subscriber statistics and list
router.get('/subscribers', verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const subscribers = await Subscriber.find()
      .sort({ subscribedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('email subscribedAt isActive lastNotificationSent');

    const total = await Subscriber.countDocuments();
    const activeCount = await Subscriber.countDocuments({ isActive: true });
    const inactiveCount = await Subscriber.countDocuments({ isActive: false });

    // Get recent subscriber growth
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recentSubscribers30 = await Subscriber.countDocuments({
      subscribedAt: { $gte: last30Days },
      isActive: true
    });

    const recentSubscribers7 = await Subscriber.countDocuments({
      subscribedAt: { $gte: last7Days },
      isActive: true
    });

    res.json({
      success: true,
      data: {
        subscribers,
        stats: {
          total,
          active: activeCount,
          inactive: inactiveCount,
          recentSubscribers30,
          recentSubscribers7
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalSubscribers: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscribers'
    });
  }
});

// PUT /api/admin/subscribers/:id/status - Toggle subscriber status
router.put('/subscribers/:id/status', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isActive must be a boolean value'
      });
    }

    const subscriber = await Subscriber.findById(id);
    if (!subscriber) {
      return res.status(404).json({
        success: false,
        error: 'Subscriber not found'
      });
    }

    subscriber.isActive = isActive;
    if (!isActive) {
      subscriber.unsubscribedAt = new Date();
    } else {
      subscriber.unsubscribedAt = undefined;
    }

    await subscriber.save();

    res.json({
      success: true,
      message: `Subscriber ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        isActive: subscriber.isActive,
        unsubscribedAt: subscriber.unsubscribedAt
      }
    });
  } catch (error) {
    console.error('Error updating subscriber status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update subscriber status'
    });
  }
});

// DELETE /api/admin/subscribers/:id - Delete subscriber
router.delete('/subscribers/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const subscriber = await Subscriber.findByIdAndDelete(id);
    if (!subscriber) {
      return res.status(404).json({
        success: false,
        error: 'Subscriber not found'
      });
    }

    res.json({
      success: true,
      message: 'Subscriber deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting subscriber:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete subscriber'
    });
  }
});

// GET /api/admin/analytics - Get detailed analytics
router.get('/analytics', verifyAdmin, async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;

    let dateFilter = {};
    const now = new Date();

    switch (timeframe) {
      case '7d':
        dateFilter = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case '30d':
        dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        break;
      case '90d':
        dateFilter = { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
        break;
      default:
        dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    }

    // Question analytics by type
    const questionAnalytics = await Question.aggregate([
      {
        $match: { createdAt: dateFilter }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            category: "$category",
            questionType: "$questionType"
          },
          count: { $sum: 1 },
          totalResponses: { $sum: { $size: "$responses" } }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    // Response analytics
    const responseAnalytics = await Question.aggregate([
      {
        $unwind: "$responses"
      },
      {
        $match: { "responses.timestamp": dateFilter }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$responses.timestamp" } }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    // Popular questions
    const popularQuestions = await Question.find()
      .sort({ 'responses.length': -1 })
      .limit(10)
      .select('title category questionType responses slug');

    res.json({
      success: true,
      data: {
        timeframe,
        questionAnalytics,
        responseAnalytics,
        popularQuestions: popularQuestions.map(q => ({
          title: q.title,
          category: q.category,
          questionType: q.questionType || 'multiple_choice',
          slug: q.slug,
          responseCount: q.responses.length,
          url: `/${q.category}/${q.slug}`
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

module.exports = router;