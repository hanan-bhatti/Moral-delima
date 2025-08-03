// scripts/updateMetrics.js
const mongoose = require('mongoose');
const Question = require('../models/Question');
require('dotenv').config();

async function updateAllMetrics() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db');
    console.log('Connected to MongoDB for metrics update...');

    console.log('Updating popularity metrics for all questions...');
    const startTime = Date.now();
    
    await Question.updateAllPopularityMetrics();
    
    const endTime = Date.now();
    const totalQuestions = await Question.countDocuments({});
    
    console.log(`Updated metrics for ${totalQuestions} questions in ${endTime - startTime}ms`);
    
    // Show some statistics
    const stats = await Question.aggregate([
      {
        $group: {
          _id: null,
          avgPopularity: { $avg: '$popularityMetrics.popularityScore' },
          maxPopularity: { $max: '$popularityMetrics.popularityScore' },
          totalViews: { $sum: '$popularityMetrics.totalViews' },
          totalResponses: { $sum: '$popularityMetrics.totalResponses' }
        }
      }
    ]);
    
    if (stats.length > 0) {
      console.log('\nPlatform Statistics:');
      console.log(`Average Popularity Score: ${Math.round(stats[0].avgPopularity * 100) / 100}`);
      console.log(`Highest Popularity Score: ${Math.round(stats[0].maxPopularity * 100) / 100}`);
      console.log(`Total Views: ${stats[0].totalViews}`);
      console.log(`Total Responses: ${stats[0].totalResponses}`);
    }

  } catch (error) {
    console.error('Error updating metrics:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

if (require.main === module) {
  updateAllMetrics();
}

module.exports = { updateAllMetrics };