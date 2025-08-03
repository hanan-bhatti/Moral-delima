const nodemailer = require('nodemailer');
const Subscriber = require('../models/Subscriber');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email credentials not configured. Email functionality will be disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  async verifyConnection() {
    if (!this.transporter) {
      throw new Error('Email transporter not configured');
    }

    try {
      await this.transporter.verify();
      console.log('Email service connected successfully');
      return true;
    } catch (error) {
      console.error('Email service connection failed:', error);
      throw error;
    }
  }

  generateNewQuestionEmail(question) {
    const questionUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${question.category}/${question.slug}`;
    const isMultipleChoice = question.questionType === 'multiple_choice';
    
    // Generate choices section only for multiple choice questions
    const choicesSection = isMultipleChoice ? `
      <div class="choices-section">
        <h3>Your options:</h3>
        <div class="choices">
          ${question.choices.map((choice, index) => 
            `<div class="choice">${choice.text}</div>`
          ).join('')}
        </div>
      </div>
    ` : `
      <div class="open-response-section">
        <p class="response-type">📝 <strong>Open Response</strong> - Share your thoughts and reasoning</p>
      </div>
    `;

    const choicesText = isMultipleChoice 
      ? question.choices.map((choice, index) => `${index + 1}. ${choice.text}`).join('\n')
      : 'This is an open response question - share your thoughts and reasoning.';

    return {
      subject: `New Moral Dilemma: ${question.title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Moral Dilemma</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              line-height: 1.6; 
              color: #1a1a1a; 
              background-color: #f8f9fa; 
            }
            .container { 
              max-width: 560px; 
              margin: 40px auto; 
              background-color: #ffffff; 
              border-radius: 12px; 
              overflow: hidden;
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            }
            .header { 
              background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); 
              color: white; 
              padding: 32px 24px; 
              text-align: center; 
            }
            .header h1 { 
              font-size: 24px; 
              font-weight: 600; 
              margin-bottom: 8px; 
            }
            .header p { 
              opacity: 0.9; 
              font-size: 15px; 
            }
            .content { 
              padding: 32px 24px; 
            }
            .question-title { 
              font-size: 20px; 
              font-weight: 600; 
              color: #1a1a1a; 
              margin-bottom: 16px; 
              line-height: 1.4; 
            }
            .question-meta { 
              background-color: #f1f5f9; 
              padding: 12px 16px; 
              border-radius: 8px; 
              margin-bottom: 24px; 
              font-size: 14px; 
            }
            .question-text { 
              background-color: #f8fafc; 
              padding: 24px; 
              border-left: 4px solid #2563eb; 
              margin: 24px 0; 
              font-size: 16px; 
              line-height: 1.7; 
              border-radius: 0 8px 8px 0; 
            }
            .choices-section h3, .open-response-section .response-type { 
              font-size: 16px; 
              font-weight: 600; 
              margin-bottom: 16px; 
              color: #374151; 
            }
            .choices { 
              display: flex; 
              flex-direction: column; 
              gap: 12px; 
            }
            .choice { 
              background-color: #f9fafb; 
              padding: 16px; 
              border-radius: 8px; 
              border: 1px solid #e5e7eb; 
              font-size: 15px; 
            }
            .open-response-section { 
              background-color: #fef3c7; 
              padding: 20px; 
              border-radius: 8px; 
              margin: 20px 0; 
              border-left: 4px solid #f59e0b; 
            }
            .response-type { 
              margin: 0 !important; 
              color: #92400e; 
            }
            .cta-section { 
              text-align: center; 
              margin: 32px 0; 
            }
            .cta-button { 
              display: inline-block; 
              background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); 
              color: white; 
              text-decoration: none; 
              padding: 16px 32px; 
              border-radius: 8px; 
              font-weight: 600; 
              font-size: 15px; 
              transition: transform 0.2s; 
            }
            .cta-text { 
              margin-top: 16px; 
              font-size: 14px; 
              color: #6b7280; 
            }
            .footer { 
              background-color: #f9fafb; 
              padding: 24px; 
              text-align: center; 
              border-top: 1px solid #e5e7eb; 
            }
            .footer p { 
              font-size: 13px; 
              color: #6b7280; 
              margin-bottom: 8px; 
            }
            .unsubscribe { 
              color: #9ca3af; 
              text-decoration: none; 
              font-size: 12px; 
            }
            .unsubscribe:hover { 
              color: #6b7280; 
            }
            @media (max-width: 600px) {
              .container { 
                margin: 20px; 
                border-radius: 8px; 
              }
              .content { 
                padding: 24px 20px; 
              }
              .header { 
                padding: 24px 20px; 
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🤔 New Moral Dilemma</h1>
              <p>A thought-provoking question awaits</p>
            </div>
            
            <div class="content">
              <h2 class="question-title">${question.title}</h2>
              
              <div class="question-meta">
                <strong>Category:</strong> ${question.category.charAt(0).toUpperCase() + question.category.slice(1)} • 
                <strong>Type:</strong> ${isMultipleChoice ? 'Multiple Choice' : 'Open Response'}
              </div>
              
              <div class="question-text">
                ${question.questionText}
              </div>
              
              ${choicesSection}
              
              <div class="cta-section">
                <a href="${questionUrl}" class="cta-button">
                  ${isMultipleChoice ? 'Cast Your Vote' : 'Share Your Response'} →
                </a>
                <div class="cta-text">
                  ${isMultipleChoice ? 'Choose your answer and explain your reasoning' : 'Share your thoughts and perspective on this dilemma'}
                </div>
              </div>
            </div>
            
            <div class="footer">
              <p>You're receiving this because you subscribed to Moral Dilemmas</p>
              <a href="{{unsubscribe_url}}" class="unsubscribe">Unsubscribe</a>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
New Moral Dilemma: ${question.title}

Category: ${question.category.charAt(0).toUpperCase() + question.category.slice(1)}
Type: ${isMultipleChoice ? 'Multiple Choice' : 'Open Response'}

${question.questionText}

${isMultipleChoice ? 'Your choices:' : 'Response Type:'}
${choicesText}

${isMultipleChoice ? 'What would you choose?' : 'What are your thoughts?'} Visit ${questionUrl} to share your perspective.

---
You're receiving this because you subscribed to Moral Dilemmas.
To unsubscribe, visit: {{unsubscribe_url}}
      `
    };
  }

  async notifySubscribers(question) {
    if (!this.transporter) {
      console.warn('Email transporter not configured. Skipping notification.');
      return;
    }

    try {
      const subscribers = await Subscriber.findActive();
      
      if (subscribers.length === 0) {
        console.log('No active subscribers to notify');
        return;
      }

      const emailTemplate = this.generateNewQuestionEmail(question);
      const results = [];

      // Send emails in batches to avoid overwhelming the email service
      const batchSize = 50;
      for (let i = 0; i < subscribers.length; i += batchSize) {
        const batch = subscribers.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (subscriber) => {
          try {
            const unsubscribeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken}`;
            
            const personalizedHtml = emailTemplate.html.replace('{{unsubscribe_url}}', unsubscribeUrl);
            const personalizedText = emailTemplate.text.replace('{{unsubscribe_url}}', unsubscribeUrl);

            await this.transporter.sendMail({
              from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
              to: subscriber.email,
              subject: emailTemplate.subject,
              html: personalizedHtml,
              text: personalizedText
            });

            // Update last notified timestamp
            await subscriber.updateLastNotified();
            
            return { email: subscriber.email, status: 'sent' };
          } catch (error) {
            console.error(`Failed to send email to ${subscriber.email}:`, error);
            return { email: subscriber.email, status: 'failed', error: error.message };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults.map(result => result.value || result.reason));

        // Add delay between batches to respect rate limits
        if (i + batchSize < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const successful = results.filter(r => r.status === 'sent').length;
      const failed = results.filter(r => r.status === 'failed').length;

      console.log(`Email notification complete: ${successful} sent, ${failed} failed`);
      
      return {
        total: subscribers.length,
        successful,
        failed,
        results
      };
    } catch (error) {
      console.error('Error sending notification emails:', error);
      throw error;
    }
  }

  async sendWelcomeEmail(subscriberEmail) {
    if (!this.transporter) {
      console.warn('Email transporter not configured. Skipping welcome email.');
      return;
    }

    try {
      const subscriber = await Subscriber.findOne({ email: subscriberEmail });
      if (!subscriber) {
        throw new Error('Subscriber not found');
      }

      const unsubscribeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken}`;

      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: subscriberEmail,
        subject: 'Welcome to Moral Dilemmas',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to Moral Dilemmas</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                line-height: 1.6; 
                color: #1a1a1a; 
                background-color: #f8f9fa; 
              }
              .container { 
                max-width: 560px; 
                margin: 40px auto; 
                background-color: #ffffff; 
                border-radius: 12px; 
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
              }
              .header { 
                background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); 
                color: white; 
                padding: 32px 24px; 
                text-align: center; 
              }
              .header h1 { 
                font-size: 24px; 
                font-weight: 600; 
                margin-bottom: 8px; 
              }
              .header p { 
                opacity: 0.9; 
                font-size: 15px; 
              }
              .content { 
                padding: 32px 24px; 
              }
              .welcome-title { 
                font-size: 20px; 
                font-weight: 600; 
                color: #1a1a1a; 
                margin-bottom: 16px; 
              }
              .welcome-text { 
                font-size: 16px; 
                margin-bottom: 24px; 
                color: #374151; 
              }
              .features { 
                background-color: #f8fafc; 
                padding: 24px; 
                border-radius: 8px; 
                margin: 24px 0; 
              }
              .feature { 
                display: flex; 
                align-items: flex-start; 
                margin-bottom: 16px; 
                font-size: 15px; 
              }
              .feature:last-child { 
                margin-bottom: 0; 
              }
              .feature-icon { 
                margin-right: 12px; 
                font-size: 16px; 
                margin-top: 2px; 
              }
              .feature-text { 
                flex: 1; 
              }
              .feature-text strong { 
                color: #1a1a1a; 
              }
              .closing-text { 
                background-color: #fef3c7; 
                padding: 20px; 
                border-radius: 8px; 
                border-left: 4px solid #f59e0b; 
                margin: 24px 0; 
                font-size: 15px; 
                color: #92400e; 
              }
              .footer { 
                background-color: #f9fafb; 
                padding: 24px; 
                text-align: center; 
                border-top: 1px solid #e5e7eb; 
              }
              .footer p { 
                font-size: 13px; 
                color: #6b7280; 
              }
              .unsubscribe { 
                color: #9ca3af; 
                text-decoration: none; 
                font-size: 12px; 
              }
              .unsubscribe:hover { 
                color: #6b7280; 
              }
              @media (max-width: 600px) {
                .container { 
                  margin: 20px; 
                  border-radius: 8px; 
                }
                .content { 
                  padding: 24px 20px; 
                }
                .header { 
                  padding: 24px 20px; 
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎭 Welcome to Moral Dilemmas</h1>
                <p>Where ethics meet curiosity</p>
              </div>
              
              <div class="content">
                <h2 class="welcome-title">Thank you for joining us!</h2>
                <p class="welcome-text">
                  You've joined a thoughtful community that explores life's most challenging ethical questions.
                </p>
                
                <div class="features">
                  <div class="feature">
                    <span class="feature-icon">📧</span>
                    <div class="feature-text">
                      <strong>Weekly dilemmas</strong> delivered to your inbox
                    </div>
                  </div>
                  <div class="feature">
                    <span class="feature-icon">🤝</span>
                    <div class="feature-text">
                      <strong>Community insights</strong> on how others approach difficult choices
                    </div>
                  </div>
                  <div class="feature">
                    <span class="feature-icon">🧠</span>
                    <div class="feature-text">
                      <strong>Thought-provoking scenarios</strong> across love, justice, family, and more
                    </div>
                  </div>
                  <div class="feature">
                    <span class="feature-icon">💭</span>
                    <div class="feature-text">
                      <strong>Safe space</strong> to explore complex moral questions
                    </div>
                  </div>
                </div>
                
                <div class="closing-text">
                  Every dilemma is designed to challenge your thinking and help you understand different perspectives. There are no right or wrong answers—only honest reflection and meaningful dialogue.
                </div>
              </div>
              
              <div class="footer">
                <p>You can <a href="${unsubscribeUrl}" class="unsubscribe">unsubscribe</a> at any time</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Welcome to Moral Dilemmas!

Thank you for joining our thoughtful community that explores life's challenging ethical questions.

Here's what you can expect:
• Weekly dilemmas delivered to your inbox
• Community insights on how others approach difficult choices  
• Thought-provoking scenarios across love, justice, family, and more
• A safe space to explore complex moral questions

Every dilemma is designed to challenge your thinking and help you understand different perspectives. There are no right or wrong answers—only honest reflection and meaningful dialogue.

You can unsubscribe at any time: ${unsubscribeUrl}
        `
      });

      console.log(`Welcome email sent to ${subscriberEmail}`);
    } catch (error) {
      console.error(`Failed to send welcome email to ${subscriberEmail}:`, error);
      throw error;
    }
  }
}

module.exports = new EmailService();