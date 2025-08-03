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

  getBaseEmailStyles() {
    return `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif; 
          line-height: 1.6; 
          color: #1f2937; 
          background: #f9fafb; 
        }
        .email-container { 
          max-width: 600px; 
          margin: 40px auto; 
          background: #ffffff; 
          border-radius: 12px; 
          overflow: hidden; 
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .header { 
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); 
          color: white; 
          padding: 40px 32px; 
          text-align: center; 
        }
        .header h1 { 
          font-size: 28px; 
          font-weight: 700; 
          margin-bottom: 8px; 
          letter-spacing: -0.025em; 
        }
        .header p { 
          font-size: 16px; 
          opacity: 0.9; 
          font-weight: 400; 
        }
        .content { 
          padding: 32px; 
        }
        .content h2 { 
          font-size: 24px; 
          font-weight: 600; 
          color: #1f2937; 
          margin-bottom: 16px; 
          letter-spacing: -0.025em; 
        }
        .content h3 { 
          font-size: 18px; 
          font-weight: 600; 
          color: #374151; 
          margin: 24px 0 12px 0; 
        }
        .content p { 
          font-size: 16px; 
          margin-bottom: 16px; 
          color: #4b5563; 
        }
        .question-card { 
          background: #f8fafc; 
          border: 1px solid #e2e8f0; 
          border-radius: 8px; 
          padding: 24px; 
          margin: 24px 0; 
        }
        .question-text { 
          font-size: 16px; 
          font-style: italic; 
          color: #1f2937; 
          line-height: 1.7; 
        }
        .choices { 
          margin: 20px 0; 
        }
        .choice { 
          background: #ffffff; 
          border: 1px solid #e5e7eb; 
          border-radius: 6px; 
          padding: 16px; 
          margin: 8px 0; 
          font-size: 15px; 
          color: #374151; 
        }
        .category-tag { 
          display: inline-block; 
          background: #ede9fe; 
          color: #7c3aed; 
          padding: 4px 12px; 
          border-radius: 20px; 
          font-size: 14px; 
          font-weight: 500; 
          margin-bottom: 16px; 
        }
        .cta-button { 
          display: inline-block; 
          background: #4f46e5 !important; 
          color: #ffffff !important; 
          text-decoration: none !important; 
          padding: 16px 32px; 
          border-radius: 8px; 
          font-weight: 600; 
          font-size: 16px; 
          text-align: center; 
          margin: 24px auto; 
          border: none;
          line-height: 1.4;
          letter-spacing: 0.025em;
        }
        .cta-button:hover {
          background: #3730a3 !important;
          color: #ffffff !important;
        }
        .cta-container { 
          text-align: center; 
          margin: 32px 0; 
        }
        .feature-list { 
          list-style: none; 
          margin: 20px 0; 
        }
        .feature-list li { 
          padding: 12px 0; 
          border-bottom: 1px solid #f3f4f6; 
          font-size: 15px; 
          color: #4b5563; 
        }
        .feature-list li:last-child { 
          border-bottom: none; 
        }
        .feature-icon { 
          display: inline-block; 
          width: 20px; 
          text-align: center; 
          margin-right: 12px; 
        }
        .footer { 
          background: #f9fafb; 
          padding: 24px 32px; 
          text-align: center; 
          border-top: 1px solid #e5e7eb; 
        }
        .footer p { 
          font-size: 14px; 
          color: #6b7280; 
          margin: 4px 0; 
        }
        .unsubscribe { 
          color: #9ca3af; 
          text-decoration: underline; 
        }
        .unsubscribe:hover { 
          color: #6b7280; 
        }
        @media (max-width: 640px) {
          .email-container { 
            margin: 20px; 
            border-radius: 8px; 
          }
          .header { 
            padding: 32px 24px; 
          }
          .content { 
            padding: 24px; 
          }
          .footer { 
            padding: 20px 24px; 
          }
        }
      </style>
    `;
  }

  generateNewQuestionEmail(question) {
    const questionUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${question.category}/${question.slug}`;
    const isMultipleChoice = question.questionType === 'multiple_choice';
    
    // Generate choices HTML for multiple choice questions
    let choicesHtml = '';
    let choicesText = '';
    
    if (isMultipleChoice && question.choices) {
      choicesHtml = question.choices.map((choice, index) => 
        `<div class="choice">${String.fromCharCode(65 + index)}. ${choice.text}</div>`
      ).join('');
      
      choicesText = question.choices.map((choice, index) => 
        `${String.fromCharCode(65 + index)}. ${choice.text}`
      ).join('\n');
    }

    const questionTypeText = isMultipleChoice ? 'Multiple Choice' : 'Open Response';

    return {
      subject: `New Moral Dilemma: ${question.title}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Moral Dilemma</title>
          ${this.getBaseEmailStyles()}
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>🤔 New Moral Dilemma</h1>
              <p>A thought-provoking question awaits your consideration</p>
            </div>
            
            <div class="content">
              <div class="category-tag">${question.category.charAt(0).toUpperCase() + question.category.slice(1)} · ${questionTypeText}</div>
              
              <h2>${question.title}</h2>
              
              <div class="question-card">
                <div class="question-text">${question.questionText}</div>
              </div>
              
              ${isMultipleChoice ? `
                <h3>Your options:</h3>
                <div class="choices">${choicesHtml}</div>
              ` : `
                <p><strong>This is an open response question.</strong> Share your thoughts, reasoning, and what you would do in this situation.</p>
              `}
              
              <div class="cta-container">
                <a href="${questionUrl}" class="cta-button" style="background: #4f46e5 !important; color: #ffffff !important; text-decoration: none !important; display: inline-block;">
                  ${isMultipleChoice ? 'Make Your Choice' : 'Share Your Response'} →
                </a>
              </div>
              
              <p>Join the discussion and see how others approach this moral dilemma. Every perspective adds value to our understanding of ethics and human nature.</p>
            </div>
            
            <div class="footer">
              <p>You're receiving this because you subscribed to Moral Dilemmas.</p>
              <p><a href="{{unsubscribe_url}}" class="unsubscribe">Unsubscribe</a> | View in browser</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
🤔 NEW MORAL DILEMMA

${question.title}
Category: ${question.category.charAt(0).toUpperCase() + question.category.slice(1)} (${questionTypeText})

${question.questionText}

${isMultipleChoice && choicesText ? `
Your options:
${choicesText}
` : 'This is an open response question. Share your complete thoughts and reasoning.'}

What would you choose? Visit ${questionUrl} to share your perspective and see how others approach this dilemma.

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
              from: `"Moral Dilemmas" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
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
      const exploreUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}`;

      await this.transporter.sendMail({
        from: `"Moral Dilemmas" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: subscriberEmail,
        subject: 'Welcome to Moral Dilemmas – Explore the Gray Areas',
        html: `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to Moral Dilemmas</title>
            ${this.getBaseEmailStyles()}
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <h1>🎭 Welcome to Moral Dilemmas</h1>
                <p>Where ethics meet curiosity</p>
              </div>
              
              <div class="content">
                <h2>Thank you for joining our community!</h2>
                <p>You've joined a thoughtful community that explores life's most challenging ethical questions. Here, there are no right or wrong answers—only honest reflection and meaningful dialogue.</p>
                
                <h3>What to expect:</h3>
                <ul class="feature-list">
                  <li><span class="feature-icon">📧</span> Weekly moral dilemmas delivered to your inbox</li>
                  <li><span class="feature-icon">🤝</span> Community insights from diverse perspectives</li>
                  <li><span class="feature-icon">🧠</span> Thought-provoking scenarios across love, justice, family, and more</li>
                  <li><span class="feature-icon">💭</span> A safe space to explore complex questions</li>
                  <li><span class="feature-icon">📊</span> Both multiple choice and open response formats</li>
                </ul>
                
                <p>Every dilemma is carefully crafted to challenge your thinking and help you understand different perspectives. Our community values respectful discourse and genuine curiosity about human nature.</p>
                
                <div class="cta-container">
                  <a href="${exploreUrl}" class="cta-button" style="background: #4f46e5 !important; color: #ffffff !important; text-decoration: none !important; display: inline-block;">
                    Explore Current Dilemmas →
                  </a>
                </div>
                
                <p>Ready to dive into your first moral challenge? Visit our website to see what questions are sparking conversations right now.</p>
              </div>
              
              <div class="footer">
                <p>Welcome to the community! We're glad you're here.</p>
                <p><a href="${unsubscribeUrl}" class="unsubscribe">Unsubscribe</a> | Questions? Reply to this email</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
🎭 WELCOME TO MORAL DILEMMAS

Thank you for joining our community!

You've joined a thoughtful community that explores life's most challenging ethical questions. Here, there are no right or wrong answers—only honest reflection and meaningful dialogue.

What to expect:
• Weekly moral dilemmas delivered to your inbox
• Community insights from diverse perspectives  
• Thought-provoking scenarios across love, justice, family, and more
• A safe space to explore complex questions
• Both multiple choice and open response formats

Every dilemma is carefully crafted to challenge your thinking and help you understand different perspectives. Our community values respectful discourse and genuine curiosity about human nature.

Ready to dive into your first moral challenge? Visit ${exploreUrl} to see what questions are sparking conversations right now.

---
Welcome to the community! We're glad you're here.
To unsubscribe, visit: ${unsubscribeUrl}
        `
      });

      console.log(`Welcome email sent to ${subscriberEmail}`);
    } catch (error) {
      console.error(`Failed to send welcome email to ${subscriberEmail}:`, error);
      throw error;
    }
  }

  async sendTestEmail(testEmail) {
    if (!this.transporter) {
      throw new Error('Email transporter not configured');
    }

    try {
      // Create a sample question for testing
      const sampleQuestion = {
        title: "The Trolley Problem Revisited",
        category: "justice",
        questionType: "multiple_choice",
        slug: "trolley-problem-test",
        questionText: "A runaway trolley is heading towards five people. You can pull a lever to divert it to another track, but this will kill one person instead. What do you do?",
        choices: [
          { text: "Pull the lever to save five lives" },
          { text: "Do nothing and let events unfold" },
          { text: "Try to warn the people instead" }
        ]
      };

      const emailTemplate = this.generateNewQuestionEmail(sampleQuestion);
      const testUnsubscribeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/subscribers/unsubscribe/test-token`;
      
      const personalizedHtml = emailTemplate.html.replace('{{unsubscribe_url}}', testUnsubscribeUrl);
      const personalizedText = emailTemplate.text.replace('{{unsubscribe_url}}', testUnsubscribeUrl);

      await this.transporter.sendMail({
        from: `"Moral Dilemmas (Test)" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to: testEmail,
        subject: `[TEST] ${emailTemplate.subject}`,
        html: personalizedHtml,
        text: personalizedText
      });

      console.log(`Test email sent to ${testEmail}`);
      return true;
    } catch (error) {
      console.error(`Failed to send test email to ${testEmail}:`, error);
      throw error;
    }
  }
}

module.exports = new EmailService();