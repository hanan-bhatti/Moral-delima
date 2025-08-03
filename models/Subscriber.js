const mongoose = require('mongoose');

const subscriberSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email address']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  subscribedAt: {
    type: Date,
    default: Date.now
  },
  lastNotified: {
    type: Date,
    default: null
  },
  unsubscribeToken: {
    type: String,
    unique: true,
    sparse: true
  }
});

// Generate unsubscribe token before saving
subscriberSchema.pre('save', function(next) {
  if (this.isNew && !this.unsubscribeToken) {
    this.unsubscribeToken = require('crypto').randomBytes(32).toString('hex');
  }
  next();
});

// Static method to find active subscribers
subscriberSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

// Instance method to unsubscribe
subscriberSchema.methods.unsubscribe = function() {
  this.isActive = false;
  return this.save();
};

// Instance method to update last notified
subscriberSchema.methods.updateLastNotified = function() {
  this.lastNotified = new Date();
  return this.save();
};

module.exports = mongoose.model('Subscriber', subscriberSchema);