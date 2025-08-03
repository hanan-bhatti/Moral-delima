// scripts/migrate.js
const mongoose = require('mongoose');
const Question = require('../models/Question');
require('dotenv').config();

async function runMigrations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db');
    console.log('Connected to MongoDB for migrations...');

    // Migration 1: Add popularity metrics to existing questions
    console.log('Running Migration 1: Adding popularity metrics...');
    const questionsWithoutMetrics = await Question.find({
      $or: [
        { popularityMetrics: { $exists: false } },
        { 'popularityMetrics.popularityScore': { $exists: false } }
      ]
    });

    console.log(`Found ${questionsWithoutMetrics.length} questions without popularity metrics`);
    
    for (const question of questionsWithoutMetrics) {
      if (!question.popularityMetrics) {
        question.popularityMetrics = {};
      }
      await question.calculatePopularityMetrics();
    }
    console.log('Migration 1 completed');

    // Migration 2: Add tags to questions that don't have them
    console.log('Running Migration 2: Adding default tags...');
    const questionsWithoutTags = await Question.find({
      $or: [
        { tags: { $exists: false } },
        { tags: { $size: 0 } }
      ]
    });

    console.log(`Found ${questionsWithoutTags.length} questions without tags`);
    
    for (const question of questionsWithoutTags) {
      const defaultTags = [question.category];
      if (question.difficulty) defaultTags.push(question.difficulty);
      if (question.questionType) defaultTags.push(question.questionType.replace('_', '-'));
      
      question.tags = defaultTags;
      await question.save();
    }
    console.log('Migration 2 completed');

    // Migration 3: Ensure all questions have estimatedReadTime
    console.log('Running Migration 3: Adding estimated read time...');
    const questionsWithoutReadTime = await Question.find({
      $or: [
        { estimatedReadTime: { $exists: false } },
        { estimatedReadTime: null }
      ]
    });

    console.log(`Found ${questionsWithoutReadTime.length} questions without read time`);
    
    for (const question of questionsWithoutReadTime) {
      // Estimate based on question text length (average reading speed ~200 words/minute)
      const wordCount = question.questionText.split(' ').length;
      question.estimatedReadTime = Math.max(1, Math.ceil(wordCount / 200));
      await question.save();
    }
    console.log('Migration 3 completed');

    console.log('All migrations completed successfully!');

  } catch (error) {
    console.error('Error running migrations:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };