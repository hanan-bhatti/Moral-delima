const express = require('express');
const router = express.Router();
const Subscriber = require('../models/Subscriber');
const EmailService = require('../services/emailService');
const Joi = require('joi');

// Validation schema
const subscribeSchema = Joi.object({
  email: Joi.string().email().required()
});

// POST /api/subscribers - Subscribe to newsletter
router.post('/', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = subscribeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }
    
    const { email } = value;
    
    // Check if email already exists
    const existingSubscriber = await Subscriber.findOne({ email });
    
    if (existingSubscriber) {
      if (existingSubscriber.isActive) {
        return res.status(409).json({
          success: false,
          error: 'Email is already subscribed'
        });
      } else {
        // Reactivate subscription
        existingSubscriber.isActive = true;
        existingSubscriber.subscribedAt = new Date();
        await existingSubscriber.save();
        
        // Send welcome email for reactivated subscription
        try {
          await EmailService.sendWelcomeEmail(email);
        } catch (emailError) {
          console.error('Failed to send welcome email:', emailError);
          // Don't fail the request if email fails, just log it
        }
        
        return res.json({
          success: true,
          message: 'Subscription reactivated successfully'
        });
      }
    }
    
    // Create new subscriber
    const subscriber = new Subscriber({ email });
    await subscriber.save();
    
    // Send welcome email to new subscriber
    try {
      await EmailService.sendWelcomeEmail(email);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the request if email fails, just log it
      // The subscription is still successful even if email fails
    }
    
    res.status(201).json({
      success: true,
      message: 'Successfully subscribed to newsletter'
    });
  } catch (error) {
    console.error('Error subscribing:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to subscribe'
    });
  }
});

// GET /api/subscribers/unsubscribe/:token - Unsubscribe from newsletter
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const subscriber = await Subscriber.findOne({ unsubscribeToken: token });
    
    if (!subscriber) {
      return res.status(404).json({
        success: false,
        error: 'Invalid unsubscribe token'
      });
    }
    
    await subscriber.unsubscribe();
    
    res.json({
      success: true,
      message: 'Successfully unsubscribed from newsletter'
    });
  } catch (error) {
    console.error('Error unsubscribing:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe'
    });
  }
});

// GET /api/subscribers/stats - Get subscriber statistics (admin only)
router.get('/stats', async (req, res) => {
  try {
    const totalSubscribers = await Subscriber.countDocuments();
    const activeSubscribers = await Subscriber.countDocuments({ isActive: true });
    const recentSubscribers = await Subscriber.countDocuments({
      subscribedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      isActive: true
    });
    
    res.json({
      success: true,
      data: {
        total: totalSubscribers,
        active: activeSubscribers,
        inactive: totalSubscribers - activeSubscribers,
        recentWeek: recentSubscribers
      }
    });
  } catch (error) {
    console.error('Error fetching subscriber stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

module.exports = router;