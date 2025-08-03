# Moral Dilemmas App

A full-stack web application for exploring thought-provoking moral dilemmas. Built with Node.js, Express, MongoDB, and vanilla JavaScript.

## Features

### 🏠 Homepage
- Dynamic loading of featured moral dilemmas from MongoDB
- Clean, philosophical dark theme design
- Email subscription system with newsletter integration
- Responsive design for all devices

### ❓ Question Pages
- Individual pages for each moral dilemma (`/category/question-slug`)
- Interactive choice selection with real-time vote counting
- Community response system with explanations
- Results visualization with percentage breakdowns
- Related questions suggestions

### 🔧 Admin Panel
- Secure admin authentication
- Dashboard with comprehensive analytics
- Question management (create, edit, delete, feature)
- Subscriber statistics and management
- Real-time notifications

### 📧 Email System
- Welcome emails for new subscribers
- Newsletter notifications for new questions
- Unsubscribe functionality
- HTML and text email templates

### 🛡️ Security & Performance
- Rate limiting and security headers
- Input validation and sanitization
- Responsive error handling
- Production-ready deployment configuration

## Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: MongoDB with Mongoose ODM
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Email**: Nodemailer
- **Security**: Helmet, CORS, Rate limiting
- **Validation**: Joi

## Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (local or cloud)
- Email service credentials (Gmail recommended)

### 1. Clone and Install
```bash
git clone <repository-url>
cd moral-dilemma-app
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/moral-dilemma-db

# Server
PORT=3000
NODE_ENV=development

# Email Configuration (Gmail example)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com

# Admin
ADMIN_SECRET=your-secret-admin-key

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000
```

### 3. Database Setup
Seed the database with sample questions:

```bash
npm run seed
```

### 4. Start the Application
```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

The application will be available at `http://localhost:3000`

## Project Structure

```
moral-dilemma-app/
├── models/
│   ├── Question.js          # Question schema and methods
│   └── Subscriber.js        # Subscriber schema and methods
├── routes/
│   ├── questions.js         # Question API routes
│   ├── subscribers.js       # Subscriber API routes
│   └── admin.js             # Admin API routes
├── services/
│   └── emailService.js      # Email functionality
├── scripts/
│   └── seedDatabase.js      # Database seeding script
├── public/
│   ├── index.html           # Homepage
│   ├── question.html        # Question page template
│   ├── admin.html           # Admin panel
│   ├── styles/
│   │   ├── main.css         # Main stylesheet
│   │   └── admin.css        # Admin-specific styles
│   └── js/
│       ├── homepage.js      # Homepage functionality
│       ├── question.js      # Question page functionality
│       └── admin.js         # Admin panel functionality
├── server.js                # Main server file
├── package.json
└── README.md
```

## API Endpoints

### Public Routes
- `GET /` - Homepage
- `GET /:category/:slug` - Question page
- `GET /api/questions` - Get questions (with pagination)
- `GET /api/questions/:category/:slug` - Get specific question
- `POST /api/questions/:category/:slug/respond` - Submit response
- `POST /api/subscribers` - Subscribe to newsletter
- `GET /api/subscribers/unsubscribe/:token` - Unsubscribe

### Admin Routes (Require Authentication)
- `GET /admin` - Admin panel
- `GET /api/admin/dashboard` - Dashboard statistics
- `GET /api/admin/questions` - Manage questions
- `POST /api/admin/questions` - Create new question
- `PUT /api/admin/questions/:id/featured` - Toggle featured status
- `DELETE /api/admin/questions/:id` - Delete question
- `GET /api/subscribers/stats` - Subscriber statistics

## Usage Guide

### Creating Questions
1. Access the admin panel at `/admin`
2. Enter your admin secret key
3. Navigate to the "Create Question" tab
4. Fill in the question details:
   - Title (engaging and descriptive)
   - Category (love, justice, survival, family, freedom, sacrifice, truth, loyalty)
   - Question text (detailed scenario)
   - Multiple choice options (2-6 choices)
   - Featured status (optional)
5. Submit to create and automatically notify subscribers

### Managing Content
- **Dashboard**: View analytics and recent activity
- **Questions**: Manage existing questions, toggle featured status
- **Subscribers**: Monitor subscription statistics

### Email Configuration
For Gmail:
1. Enable 2-factor authentication
2. Generate an app password
3. Use the app password in `EMAIL_PASS`

## Deployment

### Environment Variables for Production
```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname
FRONTEND_URL=https://yourdomain.com
EMAIL_SERVICE=gmail
EMAIL_USER=noreply@yourdomain.com
EMAIL_PASS=your-production-app-password
EMAIL_FROM=Moral Dilemmas <noreply@yourdomain.com>
ADMIN_SECRET=very-secure-random-string
PORT=3000
```

### Platform-Specific Deployment

#### Render
1. Connect your GitHub repository
2. Set environment variables in Render dashboard
3. Deploy automatically on push to main branch

#### Railway
```bash
railway login
railway init
railway add
railway deploy
```

#### Vercel (Serverless)
```bash
npm i -g vercel
vercel --prod
```

#### DigitalOcean App Platform
1. Create new app from GitHub
2. Configure environment variables
3. Deploy

## Database Schema

### Questions Collection
```javascript
{
  title: String,           // Question title
  slug: String,            // URL-friendly slug
  category: String,        // Category (enum)
  questionText: String,    // Full question description
  choices: [{
    text: String,          // Choice text
    votes: Number          // Vote count
  }],
  responses: [{
    choice: String,        // Selected choice
    explanation: String,   // User's reasoning
    createdAt: Date
  }],
  featured: Boolean,       // Homepage feature flag
  createdAt: Date,
  updatedAt: Date
}
```

### Subscribers Collection
```javascript
{
  email: String,           // Email address (unique)
  isActive: Boolean,       // Subscription status
  subscribedAt: Date,      // Subscription date
  lastNotified: Date,      // Last email sent
  unsubscribeToken: String // Unique unsubscribe token
}
```

## Security Features

- **Input Validation**: Joi schemas for all user inputs
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Configured for specific origins
- **Helmet**: Security headers for XSS, clickjacking protection
- **Admin Authentication**: Secret-based admin access
- **Email Validation**: Server-side email format validation

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, email support@moraldilemmas.com or create an issue in the repository.

---

*Building meaningful dialogue around life's most challenging questions.*