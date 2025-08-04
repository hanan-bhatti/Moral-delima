// Homepage functionality
class Homepage {
    constructor() {
        this.questionsContainer = document.getElementById('questions-grid');
        this.noQuestionsElement = document.getElementById('no-questions');
        this.loadingScreen = document.getElementById('loading-screen');
        this.newsletterForm = document.getElementById('newsletter-form');
        
        this.init();
    }

    async init() {
        try {
            await this.loadFeaturedQuestions();
            this.setupNewsletterForm();
        } catch (error) {
            console.error('Error initializing homepage:', error);
            this.showError('Failed to load content. Please refresh the page.');
        } finally {
            this.hideLoadingScreen();
        }
    }

    async loadFeaturedQuestions() {
        try {
            const response = await fetch('/api/questions?featured=true&limit=12');
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to load questions');
            }

            if (data.data.length === 0) {
                this.showNoQuestions();
                return;
            }

            this.renderQuestions(data.data);
        } catch (error) {
            console.error('Error loading featured questions:', error);
            throw error;
        }
    }

    renderQuestions(questions) {
        this.questionsContainer.innerHTML = '';
        
        questions.forEach(question => {
            const questionCard = this.createQuestionCard(question);
            this.questionsContainer.appendChild(questionCard);
        });

        this.questionsContainer.style.display = 'grid';
        this.noQuestionsElement.style.display = 'none';
    }

    createQuestionCard(question) {
        const card = document.createElement('div');
        card.className = 'question-card';
        card.addEventListener('click', () => {
            window.location.href = `/${question.category}/${question.slug}`;
        });

        const createdDate = new Date(question.createdAt);
        const formattedDate = this.formatDate(createdDate);

        card.innerHTML = `
            <div class="question-meta">
                <span class="category-tag">${question.category}</span>
                <time class="question-date">${formattedDate}</time>
            </div>
            <h3>${this.escapeHtml(question.title)}</h3>
            <p>${this.escapeHtml(this.truncateText(question.questionText, 150))}</p>
        `;

        return card;
    }

    setupNewsletterForm() {
        if (!this.newsletterForm) return;

        this.newsletterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleNewsletterSubmission();
        });
    }

    async handleNewsletterSubmission() {
        const emailInput = document.getElementById('email-input');
        const submitButton = this.newsletterForm.querySelector('button[type="submit"]');
        const buttonText = submitButton.querySelector('.button-text');
        const buttonLoading = submitButton.querySelector('.button-loading');
        const messageElement = document.getElementById('newsletter-message');

        const email = emailInput.value.trim();

        if (!this.isValidEmail(email)) {
            this.showNewsletterMessage('Please enter a valid email address.', 'error');
            return;
        }

        // Show loading state
        submitButton.disabled = true;
        buttonText.style.display = 'none';
        buttonLoading.style.display = 'flex';
        messageElement.textContent = '';
        messageElement.className = 'newsletter-message';

        try {
            const response = await fetch('/api/subscribers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (data.success) {
                this.showNewsletterMessage('🎉 Successfully subscribed! Check your email for a welcome message.', 'success');
                emailInput.value = '';
            } else {
                this.showNewsletterMessage(data.error || 'Failed to subscribe. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Newsletter subscription error:', error);
            this.showNewsletterMessage('Network error. Please check your connection and try again.', 'error');
        } finally {
            // Hide loading state
            submitButton.disabled = false;
            buttonText.style.display = 'inline';
            buttonLoading.style.display = 'none';
        }
    }

    showNewsletterMessage(message, type) {
        const messageElement = document.getElementById('newsletter-message');
        messageElement.textContent = message;
        messageElement.className = `newsletter-message ${type}`;
    }

    showNoQuestions() {
        this.questionsContainer.style.display = 'none';
        this.noQuestionsElement.style.display = 'block';
    }

    showError(message) {
        // Create and show error notification
        const notification = document.createElement('div');
        notification.className = 'notification error show';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    hideLoadingScreen() {
        if (this.loadingScreen) {
            this.loadingScreen.style.display = 'none';
        }
    }

    // Utility functions
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substr(0, maxLength).trim() + '...';
    }

    formatDate(date) {
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else if (diffDays < 30) {
            const weeks = Math.floor(diffDays / 7);
            return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
        } else {
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

// Initialize homepage when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new Homepage();
});