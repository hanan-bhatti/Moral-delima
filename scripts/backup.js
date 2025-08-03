// scripts/backup.js
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Question = require('../models/Question');
require('dotenv').config();

async function createBackup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db');
    console.log('Connected to MongoDB for backup...');

    // Create backup directory if it doesn't exist
    const backupDir = path.join(__dirname, '..', 'backups');
    try {
      await fs.access(backupDir);
    } catch {
      await fs.mkdir(backupDir, { recursive: true });
    }

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.json`);

    // Export all questions
    console.log('Exporting questions...');
    const questions = await Question.find({}).lean();
    
    const backupData = {
      exportDate: new Date(),
      version: '2.0.0',
      totalQuestions: questions.length,
      questions
    };

    // Write backup file
    await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`Backup created successfully: ${backupFile}`);
    console.log(`Backed up ${questions.length} questions`);

    // Clean up old backups (keep last 10)
    const backupFiles = await fs.readdir(backupDir);
    const backupFilesFiltered = backupFiles.filter(file => file.startsWith('backup-') && file.endsWith('.json'));
    
    if (backupFilesFiltered.length > 10) {
      backupFilesFiltered.sort();
      const filesToDelete = backupFilesFiltered.slice(0, backupFilesFiltered.length - 10);
      
      for (const file of filesToDelete) {
        await fs.unlink(path.join(backupDir, file));
        console.log(`Deleted old backup: ${file}`);
      }
    }

  } catch (error) {
    console.error('Error creating backup:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

async function restoreBackup(backupFilePath) {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db');
    console.log('Connected to MongoDB for restore...');

    // Read backup file
    const backupData = JSON.parse(await fs.readFile(backupFilePath, 'utf8'));
    console.log(`Restoring backup from ${backupData.exportDate}`);
    console.log(`Backup contains ${backupData.totalQuestions} questions`);

    // Confirm before proceeding
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      readline.question('This will replace all existing questions. Continue? (yes/no): ', resolve);
    });
    readline.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('Restore cancelled');
      return;
    }

    // Clear existing data
    await Question.deleteMany({});
    console.log('Cleared existing questions');

    // Restore questions
    await Question.insertMany(backupData.questions);
    console.log(`Restored ${backupData.totalQuestions} questions`);

    console.log('Restore completed successfully!');

  } catch (error) {
    console.error('Error restoring backup:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'restore') {
    const backupFile = process.argv[3];
    if (!backupFile) {
      console.error('Please provide backup file path');
      process.exit(1);
    }
    restoreBackup(backupFile);
  } else {
    createBackup();
  }
}

module.exports = { createBackup, restoreBackup };