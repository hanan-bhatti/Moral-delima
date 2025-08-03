const express = require('express');
const router = express.Router();
const Question = require('../models/Question');

// GET /api/analytics/dashboard - Get dashboard analytics
router.get('/dashboard', async (req, res) => {
  try {
    const timeRange = req.query.range || '7d'; // '24h', '7d', '30d', 'all'
    const category = req.query.category;
    
    let dateFilter = {};
    const now = new Date();
    
    switch (timeRange) {
      case '24h':
        dateFilter = { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
        break;
      case '7d':
        dateFilter = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case '30d':
        dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        break;
      case 'all':
      default:
        dateFilter = {}; // No date filter
        break;
    }
    
    // Build match criteria
    let matchCriteria = {};
    if (category) {
      matchCriteria.category = category.toLowerCase();
    }
    
    // Get comprehensive analytics
    const analytics = await Question.aggregate([
      { $match: matchCriteria },
      {
        $facet: {
          // Overview metrics
          overview: [
            {
              $group: {
                _id: null,
                totalQuestions: { $sum: 1 },
                totalViews: { $sum: '$popularityMetrics.totalViews' },
                totalResponses: { $sum: '$popularityMetrics.totalResponses' },
                avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
                avgEngagement: { $avg: '$popularityMetrics.engagementRate' },
                totalUniqueViews: { $sum: '$popularityMetrics.uniqueViews' },
                totalUniqueResponses: { $sum: '$popularityMetrics.uniqueResponses' }
              }
            }
          ],
          
          // Question type distribution
          questionTypes: [
            {
              $group: {
                _id: '$questionType',
                count: { $sum: 1 },
                totalViews: { $sum: '$popularityMetrics.totalViews' },
                totalResponses: { $sum: '$popularityMetrics.totalResponses' },
                avgPopularity: { $avg: '$popularityMetrics.popularityScore' }
              }
            }
          ],
          
          // Category performance
          categoryPerformance: [
            {
              $group: {
                _id: '$category',
                questionsCount: { $sum: 1 },
                totalViews: { $sum: '$popularityMetrics.totalViews' },
                totalResponses: { $sum: '$popularityMetrics.totalResponses' },
                avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
                avgEngagement: { $avg: '$popularityMetrics.engagementRate' }
              }
            },
            { $sort: { avgPopularity: -1 } }
          ],
          
          // Top performing questions
          topQuestions: [
            { $sort: { 'popularityMetrics.popularityScore': -1 } },
            { $limit: 10 },
            {
              $project: {
                title: 1,
                slug: 1,
                category: 1,
                questionType: 1,
                popularityMetrics: 1,
                createdAt: 1
              }
            }
          ],
          
          // Trending questions
          trendingQuestions: [
            { $sort: { 'popularityMetrics.trendingScore': -1 } },
            { $limit: 10 },
            {
              $project: {
                title: 1,
                slug: 1,
                category: 1,
                questionType: 1,
                popularityMetrics: 1,
                createdAt: 1
              }
            }
          ],
          
          // Recent activity (questions created in the last 30 days)
          recentActivity: [
            {
              $match: {
                createdAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
              }
            },
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                  day: { $dayOfMonth: '$createdAt' }
                },
                questionsCreated: { $sum: 1 },
                totalViews: { $sum: '$popularityMetrics.totalViews' },
                totalResponses: { $sum: '$popularityMetrics.totalResponses' }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
          ]
        }
      }
    ]);
    
    const result = analytics[0];
    
    // Format the response
    const dashboardData = {
      overview: result.overview[0] || {
        totalQuestions: 0,
        totalViews: 0,
        totalResponses: 0,
        avgPopularity: 0,
        avgEngagement: 0,
        totalUniqueViews: 0,
        totalUniqueResponses: 0
      },
      questionTypes: result.questionTypes.map(type => ({
        type: type._id,
        count: type.count,
        totalViews: type.totalViews,
        totalResponses: type.totalResponses,
        avgPopularity: Math.round(type.avgPopularity * 100) / 100
      })),
      categoryPerformance: result.categoryPerformance.map(cat => ({
        category: cat._id,
        questionsCount: cat.questionsCount,
        totalViews: cat.totalViews,
        totalResponses: cat.totalResponses,
        avgPopularity: Math.round(cat.avgPopularity * 100) / 100,
        avgEngagement: Math.round(cat.avgEngagement * 100) / 100
      })),
      topQuestions: result.topQuestions,
      trendingQuestions: result.trendingQuestions,
      recentActivity: result.recentActivity.map(activity => ({
        date: `${activity._id.year}-${String(activity._id.month).padStart(2, '0')}-${String(activity._id.day).padStart(2, '0')}`,
        questionsCreated: activity.questionsCreated,
        totalViews: activity.totalViews,
        totalResponses: activity.totalResponses
      })),
      timeRange,
      category: category || 'all',
      generatedAt: new Date()
    };
    
    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics'
    });
  }
});

// GET /api/analytics/question/:category/:slug - Get detailed question analytics
router.get('/question/:category/:slug', async (req, res) => {
  try {
    const { category, slug } = req.params;
    
    const question = await Question.findByCategoryAndSlug(category, slug);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        error: 'Question not found'
      });
    }
    
    // Analyze views over time
    const viewsAnalysis = {};
    const now = new Date();
    const periods = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    Object.keys(periods).forEach(period => {
      const cutoff = new Date(now.getTime() - periods[period]);
      viewsAnalysis[period] = question.views.filter(view => 
        new Date(view.timestamp) >= cutoff
      ).length;
    });
    
    // Analyze responses over time
    const responsesAnalysis = {};
    Object.keys(periods).forEach(period => {
      const cutoff = new Date(now.getTime() - periods[period]);
      responsesAnalysis[period] = question.responses.filter(response => 
        new Date(response.timestamp) >= cutoff
      ).length;
    });
    
    // Get unique viewers and responders
    const uniqueViewers = new Set(question.views.map(view => view.ipAddress)).size;
    const uniqueResponders = new Set(question.responses.map(response => response.ipAddress)).size;
    
    // Analyze response patterns for multiple choice questions
    let choiceAnalysis = null;
    if (question.questionType === 'multiple_choice') {
      choiceAnalysis = question.choices.map(choice => {
        const percentage = question.totalVotes > 0 ? 
          Math.round((choice.votes / question.totalVotes) * 100) : 0;
        
        return {
          choice: choice.text,
          votes: choice.votes,
          percentage,
          isPopular: percentage > (100 / question.choices.length) // Above average
        };
      });
    }
    
    // Get hourly view distribution (last 24 hours)
    const hourlyViews = Array(24).fill(0);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    question.views.forEach(view => {
      const viewDate = new Date(view.timestamp);
      if (viewDate >= last24h) {
        const hour = viewDate.getHours();
        hourlyViews[hour]++;
      }
    });
    
    // Calculate engagement metrics
    const engagementMetrics = {
      viewToResponseRate: question.views.length > 0 ? 
        Math.round((question.responses.length / question.views.length) * 100) : 0,
      uniqueEngagementRate: uniqueViewers > 0 ? 
        Math.round((uniqueResponders / uniqueViewers) * 100) : 0,
      avgResponsesPerDay: question.responses.length > 0 ? 
        Math.round((question.responses.length / Math.max(1, (now - question.createdAt) / (24 * 60 * 60 * 1000))) * 100) / 100 : 0,
      avgViewsPerDay: question.views.length > 0 ? 
        Math.round((question.views.length / Math.max(1, (now - question.createdAt) / (24 * 60 * 60 * 1000))) * 100) / 100 : 0
    };
    
    const analytics = {
      question: {
        id: question._id,
        title: question.title,
        slug: question.slug,
        category: question.category,
        questionType: question.questionType,
        createdAt: question.createdAt,
        featured: question.featured
      },
      popularityMetrics: question.popularityMetrics,
      viewsAnalysis,
      responsesAnalysis,
      uniqueMetrics: {
        uniqueViewers,
        uniqueResponders,
        totalViews: question.views.length,
        totalResponses: question.responses.length
      },
      choiceAnalysis,
      hourlyViewPattern: hourlyViews.map((views, hour) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        views
      })),
      engagementMetrics,
      generatedAt: new Date()
    };
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching question analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch question analytics'
    });
  }
});

// GET /api/analytics/category/:category - Get category-specific analytics
router.get('/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const timeRange = req.query.range || '30d';
    
    let dateFilter = {};
    const now = new Date();
    
    switch (timeRange) {
      case '24h':
        dateFilter = { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
        break;
      case '7d':
        dateFilter = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case '30d':
        dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        break;
      default:
        dateFilter = {};
        break;
    }
    
    const categoryAnalytics = await Question.aggregate([
      { $match: { category: category.toLowerCase() } },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalQuestions: { $sum: 1 },
                totalViews: { $sum: '$popularityMetrics.totalViews' },
                totalResponses: { $sum: '$popularityMetrics.totalResponses' },
                avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
                avgEngagement: { $avg: '$popularityMetrics.engagementRate' },
                multipleChoiceCount: {
                  $sum: { $cond: [{ $eq: ['$questionType', 'multiple_choice'] }, 1, 0] }
                },
                paragraphCount: {
                  $sum: { $cond: [{ $eq: ['$questionType', 'paragraph'] }, 1, 0] }
                }
              }
            }
          ],
          topPerformers: [
            { $sort: { 'popularityMetrics.popularityScore': -1 } },
            { $limit: 5 },
            {
              $project: {
                title: 1,
                slug: 1,
                questionType: 1,
                popularityMetrics: 1,
                createdAt: 1
              }
            }
          ],
          recentQuestions: [
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
            {
              $project: {
                title: 1,
                slug: 1,
                questionType: 1,
                popularityMetrics: 1,
                createdAt: 1
              }
            }
          ],
          popularityDistribution: [
            {
              $bucket: {
                groupBy: '$popularityMetrics.popularityScore',
                boundaries: [0, 10, 25, 50, 100, 500, 1000, Infinity],
                default: 'other',
                output: {
                  count: { $sum: 1 },
                  avgViews: { $avg: '$popularityMetrics.totalViews' },
                  avgResponses: { $avg: '$popularityMetrics.totalResponses' }
                }
              }
            }
          ]
        }
      }
    ]);
    
    const result = categoryAnalytics[0];
    const overview = result.overview[0] || {
      totalQuestions: 0,
      totalViews: 0,
      totalResponses: 0,
      avgPopularity: 0,
      avgEngagement: 0,
      multipleChoiceCount: 0,
      paragraphCount: 0
    };
    
    const analytics = {
      category,
      timeRange,
      overview: {
        ...overview,
        avgPopularity: Math.round(overview.avgPopularity * 100) / 100,
        avgEngagement: Math.round(overview.avgEngagement * 100) / 100
      },
      topPerformers: result.topPerformers,
      recentQuestions: result.recentQuestions,
      popularityDistribution: result.popularityDistribution.map(bucket => ({
        range: bucket._id === 'other' ? '1000+' : 
               bucket._id === 0 ? '0-10' :
               bucket._id === 10 ? '10-25' :
               bucket._id === 25 ? '25-50' :
               bucket._id === 50 ? '50-100' :
               bucket._id === 100 ? '100-500' :
               bucket._id === 500 ? '500-1000' : bucket._id,
        count: bucket.count,
        avgViews: Math.round(bucket.avgViews * 100) / 100,
        avgResponses: Math.round(bucket.avgResponses * 100) / 100
      })),
      generatedAt: new Date()
    };
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching category analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category analytics'
    });
  }
});

// GET /api/analytics/trends - Get trending analysis
router.get('/trends', async (req, res) => {
  try {
    const timeRange = req.query.range || '7d';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    
    const now = new Date();
    let cutoffDate;
    
    switch (timeRange) {
      case '24h':
        cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
    }
    
    const trendingAnalysis = await Question.aggregate([
      {
        $addFields: {
          recentViews: {
            $size: {
              $filter: {
                input: '$views',
                cond: { $gte: ['$this.timestamp', cutoffDate] }
              }
            }
          },
          recentResponses: {
            $size: {
              $filter: {
                input: '$responses',
                cond: { $gte: ['$this.timestamp', cutoffDate] }
              }
            }
          },
          trendScore: {
            $add: [
              { $multiply: ['$popularityMetrics.viewsLast24h', 2] },
              { $multiply: ['$popularityMetrics.responsesLast24h', 5] },
              { $multiply: ['$popularityMetrics.viewsLast7d', 1] },
              { $multiply: ['$popularityMetrics.responsesLast7d', 2] }
            ]
          }
        }
      },
      {
        $match: {
          $or: [
            { recentViews: { $gt: 0 } },
            { recentResponses: { $gt: 0 } }
          ]
        }
      },
      { $sort: { trendScore: -1 } },
      { $limit: limit },
      {
        $project: {
          title: 1,
          slug: 1,
          category: 1,
          questionType: 1,
          createdAt: 1,
          popularityMetrics: 1,
          recentViews: 1,
          recentResponses: 1,
          trendScore: 1
        }
      }
    ]);
    
    // Get category trends
    const categoryTrends = await Question.aggregate([
      {
        $addFields: {
          recentActivity: {
            $add: [
              '$popularityMetrics.viewsLast24h',
              { $multiply: ['$popularityMetrics.responsesLast24h', 2] }
            ]
          }
        }
      },
      {
        $group: {
          _id: '$category',
          totalActivity: { $sum: '$recentActivity' },
          questionsCount: { $sum: 1 },
          avgActivity: { $avg: '$recentActivity' },
          totalViews: { $sum: '$popularityMetrics.viewsLast24h' },
          totalResponses: { $sum: '$popularityMetrics.responsesLast24h' }
        }
      },
      { $sort: { totalActivity: -1 } },
      { $limit: 10 }
    ]);
    
    const trends = {
      timeRange,
      trendingQuestions: trendingAnalysis,
      categoryTrends: categoryTrends.map(trend => ({
        category: trend._id,
        totalActivity: trend.totalActivity,
        questionsCount: trend.questionsCount,
        avgActivity: Math.round(trend.avgActivity * 100) / 100,
        totalViews: trend.totalViews,
        totalResponses: trend.totalResponses
      })),
      insights: {
        totalTrendingQuestions: trendingAnalysis.length,
        mostActiveCategory: categoryTrends[0]?._id || null,
        avgTrendScore: trendingAnalysis.length > 0 ? 
          Math.round((trendingAnalysis.reduce((sum, q) => sum + q.trendScore, 0) / trendingAnalysis.length) * 100) / 100 : 0
      },
      generatedAt: new Date()
    };
    
    res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('Error fetching trends analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trends analysis'
    });
  }
});

// POST /api/analytics/recalculate - Recalculate all popularity metrics
router.post('/recalculate', async (req, res) => {
  try {
    const category = req.query.category;
    const batchSize = parseInt(req.query.batchSize) || 50;
    
    let query = {};
    if (category) {
      query.category = category.toLowerCase();
    }
    
    const totalQuestions = await Question.countDocuments(query);
    let processed = 0;
    const batchPromises = [];
    
    // Process in batches to avoid memory issues
    for (let skip = 0; skip < totalQuestions; skip += batchSize) {
      const batch = Question.find(query)
        .skip(skip)
        .limit(batchSize)
        .then(async (questions) => {
          const promises = questions.map(question => 
            question.calculatePopularityMetrics().catch(err => {
              console.error(`Error calculating metrics for question ${question._id}:`, err);
              return null;
            })
          );
          
          const results = await Promise.all(promises);
          processed += results.filter(r => r !== null).length;
          
          return results.length;
        });
      
      batchPromises.push(batch);
    }
    
    await Promise.all(batchPromises);
    
    res.json({
      success: true,
      message: `Recalculated popularity metrics for ${processed} questions`,
      totalQuestions,
      processedQuestions: processed,
      category: category || 'all'
    });
  } catch (error) {
    console.error('Error recalculating metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recalculate metrics'
    });
  }
});

// GET /api/analytics/export - Export analytics data
router.get('/export', async (req, res) => {
  try {
    const format = req.query.format || 'json'; // 'json' or 'csv'
    const category = req.query.category;
    const timeRange = req.query.range || 'all';
    
    let query = {};
    if (category) {
      query.category = category.toLowerCase();
    }
    
    const questions = await Question.find(query)
      .select('title slug category questionType createdAt popularityMetrics featured tags')
      .sort({ 'popularityMetrics.popularityScore': -1 });
    
    if (format === 'csv') {
      // Generate CSV format
      const csvHeaders = [
        'Title', 'Slug', 'Category', 'Type', 'Created At', 'Featured',
        'Popularity Score', 'Total Views', 'Total Responses', 'Unique Views',
        'Unique Responses', 'Engagement Rate', 'Views Last 24h', 'Views Last 7d',
        'Views Last 30d', 'Responses Last 24h', 'Responses Last 7d', 'Responses Last 30d'
      ];
      
      const csvRows = questions.map(question => [
        `"${question.title}"`,
        question.slug,
        question.category,
        question.questionType,
        question.createdAt.toISOString(),
        question.featured,
        question.popularityMetrics.popularityScore || 0,
        question.popularityMetrics.totalViews || 0,
        question.popularityMetrics.totalResponses || 0,
        question.popularityMetrics.uniqueViews || 0,
        question.popularityMetrics.uniqueResponses || 0,
        question.popularityMetrics.engagementRate || 0,
        question.popularityMetrics.viewsLast24h || 0,
        question.popularityMetrics.viewsLast7d || 0,
        question.popularityMetrics.viewsLast30d || 0,
        question.popularityMetrics.responsesLast24h || 0,
        question.popularityMetrics.responsesLast7d || 0,
        question.popularityMetrics.responsesLast30d || 0
      ]);
      
      const csv = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="questions-analytics-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      // JSON format
      const exportData = {
        metadata: {
          exportedAt: new Date(),
          category: category || 'all',
          timeRange,
          totalQuestions: questions.length
        },
        questions: questions.map(question => ({
          title: question.title,
          slug: question.slug,
          category: question.category,
          questionType: question.questionType,
          createdAt: question.createdAt,
          featured: question.featured,
          tags: question.tags,
          metrics: question.popularityMetrics
        }))
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="questions-analytics-${Date.now()}.json"`);
      res.json(exportData);
    }
  } catch (error) {
    console.error('Error exporting analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export analytics data'
    });
  }
});

module.exports = router;