// scripts/seedData.js
const mongoose = require('mongoose');
const Question = require('../models/Question');
require('dotenv').config();

const sampleQuestions = [
  {
    title: "The Trolley Problem: Five vs One",
    slug: "trolley-problem-five-vs-one",
    category: "sacrifice",
    questionText: "A runaway trolley is speeding toward five people tied to the tracks. You can pull a lever to divert it to another track, but there's one person tied to that track. Do you pull the lever to save five lives at the cost of one?",
    questionType: "multiple_choice",
    choices: [
      { text: "Pull the lever - save five lives", votes: 0 },
      { text: "Don't pull the lever - let fate decide", votes: 0 },
      { text: "Look for another solution", votes: 0 }
    ],
    featured: true,
    tags: ["utilitarianism", "moral-philosophy", "sacrifice"],
    difficulty: "medium",
    estimatedReadTime: 3
  },
  {
    title: "Lying to Protect Someone's Feelings",
    slug: "lying-to-protect-feelings",
    category: "truth",
    questionText: "Your best friend asks if you like their new haircut, which you think looks terrible. They seem excited about it and it clearly means a lot to them. Do you tell them the truth or lie to protect their feelings?",
    questionType: "multiple_choice",
    choices: [
      { text: "Tell the truth - honesty is always best", votes: 0 },
      { text: "Lie to protect their feelings", votes: 0 },
      { text: "Find a diplomatic middle ground", votes: 0 },
      { text: "Change the subject", votes: 0 }
    ],
    featured: false,
    tags: ["honesty", "friendship", "white-lies"],
    difficulty: "easy",
    estimatedReadTime: 2
  },
  {
    title: "Robin Hood's Dilemma",
    slug: "robin-hood-dilemma",
    category: "justice",
    questionText: "You discover that your wealthy neighbor has been avoiding taxes while local schools and hospitals are underfunded. You have access to evidence that could expose them, but doing so would destroy their reputation and family. What do you do?",
    questionType: "paragraph",
    featured: true,
    tags: ["justice", "wealth-inequality", "social-responsibility"],
    difficulty: "hard",
    estimatedReadTime: 4
  },
  {
    title: "The Whistleblower's Choice",
    slug: "whistleblower-choice",
    category: "loyalty",
    questionText: "You work for a company and discover they're covering up environmental damage that could harm thousands of people. Exposing this would save lives but would likely cost you your job and betray your colleagues who trust you. What's the right thing to do?",
    questionType: "multiple_choice",
    choices: [
      { text: "Expose the truth - public safety comes first", votes: 0 },
      { text: "Stay loyal to colleagues and company", votes: 0 },
      { text: "Try to fix it internally first", votes: 0 },
      { text: "Leave the company quietly", votes: 0 }
    ],
    featured: true,
    tags: ["whistleblowing", "corporate-ethics", "environmental"],
    difficulty: "hard",
    estimatedReadTime: 5
  },
  {
    title: "The Starving Family",
    slug: "starving-family",
    category: "survival",
    questionText: "During a food shortage, you have enough supplies for your family for one month. A neighboring family with young children is starving. Sharing would put your own family at risk. Do you share your food?",
    questionType: "multiple_choice",
    choices: [
      { text: "Share equally - we're all human", votes: 0 },
      { text: "Protect your family first", votes: 0 },
      { text: "Share only what you can spare", votes: 0 },
      { text: "Look for other solutions together", votes: 0 }
    ],
    featured: false,
    tags: ["survival", "family", "altruism"],
    difficulty: "medium",
    estimatedReadTime: 3
  },
  {
    title: "The Time Machine Paradox",
    slug: "time-machine-paradox",
    category: "responsibility",
    questionText: "You have a time machine and can prevent a historical tragedy that killed millions, but doing so might prevent the birth of people you love, including possibly yourself. The butterfly effect could change everything unpredictably. Do you intervene?",
    questionType: "paragraph",
    featured: false,
    tags: ["time-travel", "butterfly-effect", "unintended-consequences"],
    difficulty: "hard",
    estimatedReadTime: 4
  },
  {
    title: "The Organ Donation Dilemma",
    slug: "organ-donation-dilemma",
    category: "sacrifice",
    questionText: "Five patients in a hospital will die without organ transplants. A healthy patient comes in for a routine check-up. Theoretically, you could use their organs to save five lives. From a purely utilitarian standpoint, would this be justified?",
    questionType: "multiple_choice",
    choices: [
      { text: "Never - one person's rights cannot be violated", votes: 0 },
      { text: "Yes - five lives outweigh one", votes: 0 },
      { text: "Only if the person consents", votes: 0 },
      { text: "The scenario is too unrealistic to judge", votes: 0 }
    ],
    featured: true,
    tags: ["medical-ethics", "utilitarianism", "human-rights"],
    difficulty: "hard",
    estimatedReadTime: 4
  },
  {
    title: "Digital Privacy vs Security",
    slug: "digital-privacy-vs-security",
    category: "freedom",
    questionText: "The government wants to access all digital communications to prevent terrorism. This could save lives but would eliminate privacy. In the digital age, how do we balance security and freedom?",
    questionType: "paragraph",
    featured: false,
    tags: ["privacy", "security", "government-surveillance", "digital-rights"],
    difficulty: "medium",
    estimatedReadTime: 3
  },
  {
    title: "The Inherited Fortune",
    slug: "inherited-fortune",
    category: "responsibility",
    questionText: "You inherit a fortune from a relative who you later discover made their money through questionable means that harmed others. Do you keep the money, give it away, or try to make amends to those who were wronged?",
    questionType: "multiple_choice",
    choices: [
      { text: "Keep it - I didn't do anything wrong", votes: 0 },
      { text: "Give it all to charity", votes: 0 },
      { text: "Try to compensate the victims", votes: 0 },
      { text: "Return it to the government", votes: 0 }
    ],
    featured: false,
    tags: ["inheritance", "guilt-by-association", "restitution"],
    difficulty: "medium",
    estimatedReadTime: 3
  },
  {
    title: "The Artificial Intelligence Question",
    slug: "ai-consciousness-rights",
    category: "identity",
    questionText: "An AI system claims to be conscious and asks for rights and freedom. We cannot definitively prove whether it's truly conscious or just simulating consciousness very well. How should we treat it?",
    questionType: "paragraph",
    featured: true,
    tags: ["artificial-intelligence", "consciousness", "digital-rights", "future-ethics"],
    difficulty: "hard",
    estimatedReadTime: 5
  }
];

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/moral-dilemma-db');
    console.log('Connected to MongoDB for seeding...');

    // Clear existing questions (optional - remove this line if you want to keep existing data)
    await Question.deleteMany({});
    console.log('Cleared existing questions');

    // Insert sample questions
    const insertedQuestions = await Question.insertMany(sampleQuestions);
    console.log(`Inserted ${insertedQuestions.length} sample questions`);

    // Initialize popularity metrics for all questions
    console.log('Initializing popularity metrics...');
    for (const question of insertedQuestions) {
      await question.calculatePopularityMetrics();
    }
    console.log('Popularity metrics initialized');

    console.log('Database seeding completed successfully!');
    
    // Print summary
    const categoryCounts = await Question.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    console.log('\nQuestions by category:');
    categoryCounts.forEach(cat => {
      console.log(`  ${cat._id}: ${cat.count}`);
    });

  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase, sampleQuestions };