// scripts/backup.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
require('dotenv').config();

const execAsync = promisify(exec);

class DatabaseBackup {
  constructor() {
    this.backupDir = path.join(__dirname, '..', 'backups');
    this.mongoUri = process.env.MONGODB_URI;
    this.retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
  }

  /**
   * Ensure backup directory exists
   */
  ensureBackupDirectory() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
      console.log('Created backup directory:', this.backupDir);
    }
  }

  /**
   * Generate backup filename with timestamp
   */
  generateBackupFilename() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `moral-dilemma-backup-${timestamp}.gz`;
  }

  /**
   * Create MongoDB backup using mongodump
   */
  async createMongoBackup() {
    try {
      this.ensureBackupDirectory();
      
      const backupFilename = this.generateBackupFilename();
      const backupPath = path.join(this.backupDir, backupFilename);
      
      console.log('Starting MongoDB backup...');
      console.log('Backup file:', backupPath);
      
      // Extract database name from MongoDB URI
      const dbName = this.mongoUri.split('/').pop().split('?')[0];
      
      // Create mongodump command
      const dumpCommand = `mongodump --uri="${this.mongoUri}" --archive="${backupPath}" --gzip`;
      
      console.log('Executing:', dumpCommand.replace(this.mongoUri, '[URI_HIDDEN]'));
      
      const { stdout, stderr } = await execAsync(dumpCommand);
      
      if (stderr && !stderr.includes('done dumping')) {
        console.error('Backup stderr:', stderr);
      }
      
      if (stdout) {
        console.log('Backup stdout:', stdout);
      }
      
      // Verify backup file was created
      if (fs.existsSync(backupPath)) {
        const stats = fs.statSync(backupPath);
        console.log(`✅ Backup completed successfully!`);
        console.log(`📁 File: ${backupFilename}`);
        console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`📅 Created: ${stats.birthtime}`);
        
        return {
          success: true,
          filename: backupFilename,
          path: backupPath,
          size: stats.size,
          date: stats.birthtime
        };
      } else {
        throw new Error('Backup file was not created');
      }
      
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create application data backup (JSON export)
   */
  async createDataExport() {
    try {
      console.log('Creating application data export...');
      
      await mongoose.connect(this.mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      
      // Import models
      const Question = require('../models/Question');
      const Subscriber = require('../models/Subscriber');
      
      // Export data
      const questions = await Question.find({}).lean();
      const subscribers = await Subscriber.find({}).lean();
      
      const exportData = {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        counts: {
          questions: questions.length,
          subscribers: subscribers.length
        },
        data: {
          questions,
          subscribers: subscribers.map(sub => ({
            email: sub.email,
            categories: sub.categories,
            subscribedAt: sub.subscribedAt,
            isActive: sub.isActive
          })) // Remove sensitive data
        }
      };
      
      const exportFilename = `data-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const exportPath = path.join(this.backupDir, exportFilename);
      
      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
      
      const stats = fs.statSync(exportPath);
      console.log(`✅ Data export completed!`);
      console.log(`📁 File: ${exportFilename}`);
      console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
      console.log(`📊 Questions: ${questions.length}`);
      console.log(`📊 Subscribers: ${subscribers.length}`);
      
      await mongoose.disconnect();
      
      return {
        success: true,
        filename: exportFilename,
        path: exportPath,
        size: stats.size,
        counts: exportData.counts
      };
      
    } catch (error) {
      console.error('❌ Data export failed:', error.message);
      await mongoose.disconnect();
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up old backup files
   */
  async cleanupOldBackups() {
    try {
      console.log(`🧹 Cleaning up backups older than ${this.retentionDays} days...`);
      
      const files = fs.readdirSync(this.backupDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      let deletedCount = 0;
      let deletedSize = 0;
      
      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.birthtime < cutoffDate) {
          deletedSize += stats.size;
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`🗑️  Deleted old backup: ${file}`);
        }
      }
      
      console.log(`✅ Cleanup completed!`);
      console.log(`📁 Deleted files: ${deletedCount}`);
      console.log(`💾 Space freed: ${(deletedSize / 1024 / 1024).toFixed(2)} MB`);
      
      return {
        success: true,
        deletedCount,
        deletedSize
      };
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List all backup files
   */
  listBackups() {
    try {
      this.ensureBackupDirectory();
      
      const files = fs.readdirSync(this.backupDir);
      const backups = files.map(file => {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        
        return {
          filename: file,
          size: stats.size,
          sizeFormatted: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
          created: stats.birthtime,
          age: Math.floor((Date.now() - stats.birthtime.getTime()) / (1000 * 60 * 60 * 24))
        };
      }).sort((a, b) => b.created - a.created);
      
      console.log('\n📋 Available Backups:');
      console.log('─'.repeat(80));
      
      if (backups.length === 0) {
        console.log('No backups found.');
        return [];
      }
      
      backups.forEach((backup, index) => {
        console.log(`${index + 1}. ${backup.filename}`);
        console.log(`   Size: ${backup.sizeFormatted}`);
        console.log(`   Created: ${backup.created.toLocaleString()}`);
        console.log(`   Age: ${backup.age} days`);
        console.log('');
      });
      
      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
      console.log(`Total: ${backups.length} backups, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log('─'.repeat(80));
      
      return backups;
      
    } catch (error) {
      console.error('❌ Failed to list backups:', error.message);
      return [];
    }
  }

  /**
   * Restore from backup (MongoDB)
   */
  async restoreFromBackup(backupFilename) {
    try {
      const backupPath = path.join(this.backupDir, backupFilename);
      
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupFilename}`);
      }
      
      console.log('⚠️  WARNING: This will replace all existing data!');
      console.log('Starting restore from:', backupFilename);
      
      const restoreCommand = `mongorestore --uri="${this.mongoUri}" --archive="${backupPath}" --gzip --drop`;
      
      console.log('Executing restore...');
      const { stdout, stderr } = await execAsync(restoreCommand);
      
      if (stderr && !stderr.includes('done')) {
        console.error('Restore stderr:', stderr);
      }
      
      if (stdout) {
        console.log('Restore stdout:', stdout);
      }
      
      console.log('✅ Restore completed successfully!');
      
      return {
        success: true,
        restoredFrom: backupFilename
      };
      
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get backup statistics
   */
  getBackupStats() {
    try {
      this.ensureBackupDirectory();
      
      const files = fs.readdirSync(this.backupDir);
      let totalSize = 0;
      let oldestBackup = null;
      let newestBackup = null;
      
      files.forEach(file => {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        
        totalSize += stats.size;
        
        if (!oldestBackup || stats.birthtime < oldestBackup) {
          oldestBackup = stats.birthtime;
        }
        
        if (!newestBackup || stats.birthtime > newestBackup) {
          newestBackup = stats.birthtime;
        }
      });
      
      return {
        totalFiles: files.length,
        totalSize,
        totalSizeFormatted: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        oldestBackup,
        newestBackup,
        retentionDays: this.retentionDays
      };
      
    } catch (error) {
      console.error('❌ Failed to get backup stats:', error.message);
      return null;
    }
  }
}

// CLI interface
async function main() {
  const backup = new DatabaseBackup();
  const command = process.argv[2];
  
  console.log('🗄️  Moral Dilemma Platform - Database Backup Tool');
  console.log('═'.repeat(60));
  
  switch (command) {
    case 'create':
      console.log('Creating full backup...\n');
      const mongoResult = await backup.createMongoBackup();
      const exportResult = await backup.createDataExport();
      
      if (mongoResult.success && exportResult.success) {
        console.log('\n✅ Full backup completed successfully!');
      } else {
        console.log('\n❌ Backup completed with errors');
      }
      break;
      
    case 'mongo':
      await backup.createMongoBackup();
      break;
      
    case 'export':
      await backup.createDataExport();
      break;
      
    case 'list':
      backup.listBackups();
      break;
      
    case 'cleanup':
      await backup.cleanupOldBackups();
      break;
      
    case 'restore':
      const filename = process.argv[3];
      if (!filename) {
        console.log('❌ Please provide backup filename');
        console.log('Usage: node scripts/backup.js restore <filename>');
        process.exit(1);
      }
      await backup.restoreFromBackup(filename);
      break;
      
    case 'stats':
      const stats = backup.getBackupStats();
      if (stats) {
        console.log('📊 Backup Statistics:');
        console.log(`   Total backups: ${stats.totalFiles}`);
        console.log(`   Total size: ${stats.totalSizeFormatted}`);
        console.log(`   Retention: ${stats.retentionDays} days`);
        if (stats.oldestBackup) {
          console.log(`   Oldest: ${stats.oldestBackup.toLocaleString()}`);
        }
        if (stats.newestBackup) {
          console.log(`   Newest: ${stats.newestBackup.toLocaleString()}`);
        }
      }
      break;
      
    default:
      console.log('Available commands:');
      console.log('  create   - Create full backup (MongoDB + data export)');
      console.log('  mongo    - Create MongoDB backup only');
      console.log('  export   - Create data export only');
      console.log('  list     - List all backups');
      console.log('  cleanup  - Remove old backups');
      console.log('  restore  - Restore from backup');
      console.log('  stats    - Show backup statistics');
      console.log('\nExamples:');
      console.log('  npm run backup');
      console.log('  node scripts/backup.js create');
      console.log('  node scripts/backup.js restore backup-2024-01-15.gz');
      break;
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = DatabaseBackup;