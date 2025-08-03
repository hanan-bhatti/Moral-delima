// Question page functionality
class QuestionPage {
    constructor() {
        this.loadingScreen = document.getElementById('loading-screen');
        this.questionContainer = document.getElementById('question-container');
        this.errorContainer = document.getElementById('error-container');
        
        // Multiple choice elements
        this.multipleChoiceSection = document.getElementById('multiple-choice-section');
        this.mcResponseSection = document.getElementById('mc-response-section');
        this.mcResultsSection = document.getElementById('mc-results-section');
        
        // Paragraph elements
        this.paragraphSection = document.getElementById('paragraph-section');
        
        // Shared elements
        this.responsesSection = document.getElementById('responses-section');
        this.thankYouSection = document.getElementById('thank-you-section');
        
        this.currentQuestion = null;
        this.selectedChoice = null;
        this.responsePage = 1;
        this.userResponseKey = '';
        
        this.init();
    }

    async init() {
        try {
            const pathParts = window.location.pathname.split('/');
            if (pathParts.length !== 3) {
                throw new Error('Invalid URL format');
            }

            const category = pathParts[1];
            const slug = pathParts[2];
            this.userResponseKey = `response_${category}_${slug}`;

            await this.loadQuestion(category, slug);
            this.setupEventListeners();
        } catch (error) {
            console.error('Error initializing question page:', error);
            this.showError();
        } finally {
            this.hideLoadingScreen();
        }
    }

    async loadQuestion(category, slug) {
        try {
            const response = await fetch(`/api/questions/${category}/${slug}`);
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Question not found');
            }

            this.currentQuestion = data.data;
            this.renderQuestion();
            this.checkUserResponse();
            await this.loadRelatedQuestions(category);
        } catch (error) {
            console.error('Error loading question:', error);
            throw error;
        }
    }

    renderQuestion() {
        // Update page title and meta
        document.getElementById('page-title').textContent = `${this.currentQuestion.title} - Moral Dilemmas`;
        document.getElementById('page-description').setAttribute('content', this.currentQuestion.questionText);

        // Render question content
        document.getElementById('question-category').textContent = this.currentQuestion.category;
        document.getElementById('question-category').className = `category-tag category-${this.currentQuestion.category}`;
        
        // Show question type
        const questionTypeTag = document.getElementById('question-type');
        const questionType = this.currentQuestion.questionType || 'multiple_choice';
        questionTypeTag.textContent = questionType === 'multiple_choice' ? 'Multiple Choice' : 'Open Response';
        questionTypeTag.className = `question-type-tag type-${questionType}`;
        
        document.getElementById('question-date').textContent = this.formatDate(new Date(this.currentQuestion.createdAt));
        document.getElementById('question-title').textContent = this.currentQuestion.title;
        document.getElementById('question-text').textContent = this.currentQuestion.questionText;

        // Update sidebar stats
        document.getElementById('sidebar-question-type').textContent = questionType === 'multiple_choice' ? 'Multiple Choice' : 'Open Response';
        document.getElementById('sidebar-response-count').textContent = this.currentQuestion.responseCount || this.currentQuestion.responses?.length || 0;
        document.getElementById('sidebar-question-date').textContent = this.formatDate(new Date(this.currentQuestion.createdAt));

        // Show appropriate section based on question type
        if (questionType === 'multiple_choice') {
            this.renderMultipleChoice();
        } else {
            this.renderParagraphQuestion();
        }

        // Show question container
        this.questionContainer.style.display = 'block';
    }

    renderMultipleChoice() {
        this.multipleChoiceSection.style.display = 'block';
        this.paragraphSection.style.display = 'none';
        
        // Render choices
        const choicesContainer = document.getElementById('choices-container');
        choicesContainer.innerHTML = '';

        this.currentQuestion.choices.forEach((choice, index) => {
            const choiceElement = this.createChoiceElement(choice, index);
            choicesContainer.appendChild(choiceElement);
        });
    }

    renderParagraphQuestion() {
        this.multipleChoiceSection.style.display = 'none';
        this.paragraphSection.style.display = 'block';
        
        // Update responses title for paragraph questions
        const responsesTitle = document.getElementById('responses-title');
        if (responsesTitle) {
            responsesTitle.textContent = 'Community Responses';
        }
    }

    createChoiceElement(choice, index) {
        const choiceDiv = document.createElement('div');
        choiceDiv.className = 'choice-option';
        choiceDiv.dataset.choiceText = choice.text;

        choiceDiv.innerHTML = `
            <input type="radio" name="choice" id="choice-${index}" value="${this.escapeHtml(choice.text)}">
            <div class="choice-text">${this.escapeHtml(choice.text)}</div>
            <div class="choice-votes">${choice.votes} ${choice.votes === 1 ? 'vote' : 'votes'}</div>
        `;

        choiceDiv.addEventListener('click', () => {
            this.selectChoice(choiceDiv, choice.text);
        });

        return choiceDiv;
    }

    selectChoice(choiceElement, choiceText) {
        // Remove previous selection
        document.querySelectorAll('.choice-option').forEach(el => {
            el.classList.remove('selected');
        });

        // Select current choice
        choiceElement.classList.add('selected');
        choiceElement.querySelector('input').checked = true;
        this.selectedChoice = choiceText;

        // Show response section
        this.mcResponseSection.style.display = 'block';
        this.mcResponseSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    checkUserResponse() {
        const userResponse = this.getUserResponse();
        if (userResponse) {
            if (this.currentQuestion.questionType === 'multiple_choice') {
                this.showMultipleChoiceResults(userResponse);
            } else {
                this.showParagraphSubmitted(userResponse);
            }
            this.loadResponses();
        }
    }

    showMultipleChoiceResults(userResponse) {
        // Hide interaction elements
        document.querySelectorAll('.choice-option').forEach(el => {
            el.style.pointerEvents = 'none';
            if (el.dataset.choiceText === userResponse.choice) {
                el.classList.add('user-selected');
            }
        });
        
        this.mcResponseSection.style.display = 'none';
        this.showResults();
        this.showThankYou();
    }

    showParagraphSubmitted(userResponse) {
        // Hide the response form
        this.paragraphSection.querySelector('.response-form').style.display = 'none';
        
        // Show user's response
        const userResponseDiv = document.createElement('div');
        userResponseDiv.className = 'user-response-display';
        userResponseDiv.innerHTML = `
            <h4>Your Response:</h4>
            <div class="user-response-text">${this.escapeHtml(userResponse.responseText || userResponse.explanation)}</div>
            <div class="user-response-date">Submitted: ${this.formatDate(new Date(userResponse.timestamp))}</div>
        `;
        
        this.paragraphSection.appendChild(userResponseDiv);
        this.showThankYou();
    }

    showThankYou() {
        this.thankYouSection.style.display = 'block';
    }

    setupEventListeners() {
        // Multiple choice response form
        const mcResponseForm = document.getElementById('mc-response-form');
        if (mcResponseForm) {
            mcResponseForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.submitMultipleChoiceResponse();
            });
        }

        // Paragraph response form
        const paragraphResponseForm = document.getElementById('paragraph-response-form');
        if (paragraphResponseForm) {
            paragraphResponseForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.submitParagraphResponse();
            });
        }

        // Character counters
        this.setupCharacterCounters();

        // Response filtering and sorting
        this.setupResponseControls();

        // Load more responses button
        const loadMoreButton = document.getElementById('load-more-responses');
        if (loadMoreButton) {
            loadMoreButton.addEventListener('click', () => {
                this.loadMoreResponses();
            });
        }

        // Newsletter form in sidebar
        const sidebarNewsletterForm = document.getElementById('sidebar-newsletter-form');
        if (sidebarNewsletterForm) {
            sidebarNewsletterForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleSidebarNewsletter();
            });
        }
    }

    setupCharacterCounters() {
        // MC explanation counter
        const mcExplanationInput = document.getElementById('mc-explanation-input');
        const mcCharCount = document.getElementById('mc-char-count');
        if (mcExplanationInput && mcCharCount) {
            mcExplanationInput.addEventListener('input', () => {
                mcCharCount.textContent = mcExplanationInput.value.length;
            });
        }

        // Paragraph response counter
        const paragraphResponseInput = document.getElementById('paragraph-response-input');
        const paragraphCharCount = document.getElementById('paragraph-char-count');
        if (paragraphResponseInput && paragraphCharCount) {
            paragraphResponseInput.addEventListener('input', () => {
                paragraphCharCount.textContent = paragraphResponseInput.value.length;
            });
        }
    }

    setupResponseControls() {
        // Choice filter for multiple choice questions
        const choiceFilterSelect = document.getElementById('choice-filter-select');
        if (choiceFilterSelect && this.currentQuestion.questionType === 'multiple_choice') {
            // Populate choice filter options
            this.currentQuestion.choices.forEach(choice => {
                const option = document.createElement('option');
                option.value = choice.text;
                option.textContent = choice.text;
                choiceFilterSelect.appendChild(option);
            });

            choiceFilterSelect.addEventListener('change', () => {
                this.filterResponses(choiceFilterSelect.value);
            });

            document.getElementById('mc-choice-filter').style.display = 'block';
        }

        // Sort responses
        const sortSelect = document.getElementById('sort-responses');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.sortResponses(sortSelect.value);
            });
        }
    }

    async submitMultipleChoiceResponse() {
        if (!this.selectedChoice) {
            this.showNotification('Please select a choice first.', 'error');
            return;
        }

        const explanationInput = document.getElementById('mc-explanation-input');
        const explanation = explanationInput.value.trim();

        if (explanation.length < 10) {
            this.showNotification('Please provide at least 10 characters for your explanation.', 'error');
            return;
        }

        const submitButton = document.querySelector('#mc-response-form button[type="submit"]');
        const buttonText = submitButton.querySelector('.button-text');
        const buttonLoading = submitButton.querySelector('.button-loading');

        // Show loading state
        submitButton.disabled = true;
        buttonText.style.display = 'none';
        buttonLoading.style.display = 'flex';

        try {
            const pathParts = window.location.pathname.split('/');
            const category = pathParts[1];
            const slug = pathParts[2];

            const response = await fetch(`/api/questions/${category}/${slug}/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    choice: this.selectedChoice,
                    explanation: explanation
                })
            });

            const data = await response.json();

            if (data.success) {
                // Save user response to localStorage
                this.saveUserResponse({
                    choice: this.selectedChoice,
                    explanation: explanation,
                    timestamp: new Date().toISOString(),
                    questionType: 'multiple_choice'
                });

                this.showNotification('Thank you for sharing your perspective!', 'success');
                
                // Update vote counts
                this.updateVoteCounts(data.data.choices);
                
                // Hide response form and show results
                this.mcResponseSection.style.display = 'none';
                this.showResults();
                this.showThankYou();
                await this.loadResponses();
            } else {
                this.showNotification(data.error || 'Failed to submit response.', 'error');
            }
        } catch (error) {
            console.error('Error submitting response:', error);
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            // Hide loading state
            submitButton.disabled = false;
            buttonText.style.display = 'inline';
            buttonLoading.style.display = 'none';
        }
    }

    async submitParagraphResponse() {
        const responseInput = document.getElementById('paragraph-response-input');
        const responseText = responseInput.value.trim();

        if (responseText.length < 20) {
            this.showNotification('Please provide at least 20 characters for your response.', 'error');
            return;
        }

        const submitButton = document.querySelector('#paragraph-response-form button[type="submit"]');
        const buttonText = submitButton.querySelector('.button-text');
        const buttonLoading = submitButton.querySelector('.button-loading');

        // Show loading state
        submitButton.disabled = true;
        buttonText.style.display = 'none';
        buttonLoading.style.display = 'flex';

        try {
            const pathParts = window.location.pathname.split('/');
            const category = pathParts[1];
            const slug = pathParts[2];

            const response = await fetch(`/api/questions/${category}/${slug}/respond`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    responseText: responseText,
                    explanation: '' // Optional for paragraph responses
                })
            });

            const data = await response.json();

            if (data.success) {
                // Save user response to localStorage
                this.saveUserResponse({
                    responseText: responseText,
                    timestamp: new Date().toISOString(),
                    questionType: 'paragraph'
                });

                this.showNotification('Thank you for sharing your response!', 'success');
                
                // Hide form and show user's response
                this.showParagraphSubmitted({
                    responseText: responseText,
                    timestamp: new Date().toISOString()
                });
                
                await this.loadResponses();
            } else {
                this.showNotification(data.error || 'Failed to submit response.', 'error');
            }
        } catch (error) {
            console.error('Error submitting response:', error);
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            // Hide loading state
            submitButton.disabled = false;
            buttonText.style.display = 'inline';
            buttonLoading.style.display = 'none';
        }
    }

    saveUserResponse(responseData) {
        try {
            localStorage.setItem(this.userResponseKey, JSON.stringify(responseData));
        } catch (error) {
            console.error('Error saving user response to localStorage:', error);
        }
    }

    getUserResponse() {
        try {
            const stored = localStorage.getItem(this.userResponseKey);
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            console.error('Error getting user response from localStorage:', error);
            return null;
        }
    }

    updateVoteCounts(choices) {
        choices.forEach(choice => {
            const choiceElement = document.querySelector(`[data-choice-text="${choice.text}"]`);
            if (choiceElement) {
                const votesElement = choiceElement.querySelector('.choice-votes');
                votesElement.textContent = `${choice.votes} ${choice.votes === 1 ? 'vote' : 'votes'}`;
            }
        });
    }

    showResults() {
        const resultsChart = document.getElementById('mc-results-chart');
        resultsChart.innerHTML = '';

        const totalVotes = this.currentQuestion.choices.reduce((sum, choice) => sum + choice.votes, 0);

        this.currentQuestion.choices.forEach(choice => {
            const percentage = totalVotes > 0 ? (choice.votes / totalVotes * 100) : 0;
            
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            
            resultItem.innerHTML = `
                <div class="result-label">${this.escapeHtml(choice.text)}</div>
                <div class="result-bar-container">
                    <div class="result-bar" style="width: ${percentage}%"></div>
                </div>
                <div class="result-percentage">${percentage.toFixed(1)}%</div>
            `;
            
            resultsChart.appendChild(resultItem);
        });

        this.mcResultsSection.style.display = 'block';
    }

    async loadResponses() {
        try {
            const pathParts = window.location.pathname.split('/');
            const category = pathParts[1];
            const slug = pathParts[2];

            const response = await fetch(`/api/questions/${category}/${slug}/responses?page=1&limit=10`);
            const data = await response.json();

            if (data.success && data.data.responses.length > 0) {
                this.renderResponses(data.data.responses);
                this.responsesSection.style.display = 'block';
                
                // Show load more button if there are more responses
                const loadMoreButton = document.getElementById('load-more-responses');
                if (data.data.totalPages > 1) {
                    loadMoreButton.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error loading responses:', error);
        }
    }

    async loadMoreResponses() {
        this.responsePage++;
        
        try {
            const pathParts = window.location.pathname.split('/');
            const category = pathParts[1];
            const slug = pathParts[2];

            const response = await fetch(`/api/questions/${category}/${slug}/responses?page=${this.responsePage}&limit=10`);
            const data = await response.json();

            if (data.success && data.data.responses.length > 0) {
                this.renderResponses(data.data.responses, true);
                
                // Hide load more button if no more pages
                if (this.responsePage >= data.data.totalPages) {
                    document.getElementById('load-more-responses').style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error loading more responses:', error);
        }
    }

    renderResponses(responses, append = false) {
        const responsesContainer = document.getElementById('responses-container');
        
        if (!append) {
            responsesContainer.innerHTML = '';
        }

        responses.forEach(response => {
            const responseElement = this.createResponseElement(response);
            responsesContainer.appendChild(responseElement);
        });
    }

    createResponseElement(response) {
        const responseDiv = document.createElement('div');
        responseDiv.className = 'response-item';
        responseDiv.dataset.choice = response.choice || '';

        const createdDate = new Date(response.createdAt || response.timestamp);
        const formattedDate = this.formatDate(createdDate);

        let responseContent = '';
        if (this.currentQuestion.questionType === 'multiple_choice') {
            responseContent = `
                <div class="response-header">
                    <div class="response-choice">${this.escapeHtml(response.choice)}</div>
                    <div class="response-date">${formattedDate}</div>
                </div>
                <div class="response-text">${this.escapeHtml(response.explanation)}</div>
            `;
        } else {
            responseContent = `
                <div class="response-header">
                    <div class="response-date">${formattedDate}</div>
                </div>
                <div class="response-text">${this.escapeHtml(response.responseText || response.explanation)}</div>
            `;
        }

        responseDiv.innerHTML = responseContent;
        return responseDiv;
    }

    filterResponses(choiceFilter) {
        const responses = document.querySelectorAll('.response-item');
        responses.forEach(response => {
            if (!choiceFilter || response.dataset.choice === choiceFilter) {
                response.style.display = 'block';
            } else {
                response.style.display = 'none';
            }
        });
    }

    sortResponses(sortOrder) {
        const responsesContainer = document.getElementById('responses-container');
        const responses = Array.from(responsesContainer.querySelectorAll('.response-item'));
        
        responses.sort((a, b) => {
            const dateA = new Date(a.querySelector('.response-date').textContent);
            const dateB = new Date(b.querySelector('.response-date').textContent);
            
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
        
        responses.forEach(response => responsesContainer.appendChild(response));
    }

    async loadRelatedQuestions(category) {
        try {
            const response = await fetch(`/api/questions?limit=6`);
            const data = await response.json();

            if (data.success && data.data.length > 0) {
                // Filter out current question and prefer same category
                const relatedQuestions = data.data
                    .filter(q => q._id !== this.currentQuestion._id)
                    .sort((a, b) => {
                        if (a.category === category && b.category !== category) return -1;
                        if (b.category === category && a.category !== category) return 1;
                        return 0;
                    })
                    .slice(0, 3);

                this.renderRelatedQuestions(relatedQuestions);
            }
        } catch (error) {
            console.error('Error loading related questions:', error);
        }
    }

    renderRelatedQuestions(questions) {
        const relatedContainer = document.getElementById('related-questions');
        relatedContainer.innerHTML = '';

        questions.forEach(question => {
            const questionElement = document.createElement('div');
            questionElement.className = 'related-question';
            const questionType = question.questionType === 'paragraph' ? '📝' : '📊';
            questionElement.innerHTML = `
                <a href="/${question.category}/${question.slug}" class="related-question-link">
                    <div class="related-question-meta">
                        <span class="related-question-category">${question.category}</span>
                        <span class="related-question-type">${questionType}</span>
                    </div>
                    <div class="related-question-title">${this.escapeHtml(question.title)}</div>
                </a>
            `;
            relatedContainer.appendChild(questionElement);
        });
    }

    async handleSidebarNewsletter() {
        const form = document.getElementById('sidebar-newsletter-form');
        const emailInput = form.querySelector('input[type="email"]');
        const submitButton = form.querySelector('button[type="submit"]');
        
        const email = emailInput.value.trim();

        if (!this.isValidEmail(email)) {
            this.showNotification('Please enter a valid email address.', 'error');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Subscribing...';

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
                this.showNotification('Successfully subscribed!', 'success');
                emailInput.value = '';
            } else {
                this.showNotification(data.error || 'Failed to subscribe.', 'error');
            }
        } catch (error) {
            console.error('Newsletter subscription error:', error);
            this.showNotification('Network error. Please try again.', 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Subscribe';
        }
    }

    showError() {
        this.questionContainer.style.display = 'none';
        this.errorContainer.style.display = 'block';
    }

    hideLoadingScreen() {
        this.loadingScreen.style.display = 'none';
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => notification.remove());

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <span>${this.escapeHtml(message)}</span>
            <button class="notification-close">×</button>
        `;

        // Add to document
        document.body.appendChild(notification);

        // Add close event listener
        const closeButton = notification.querySelector('.notification-close');
        closeButton.addEventListener('click', () => {
            notification.remove();
        });

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);

        // Trigger animation
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(date) {
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}

// Initialize question page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new QuestionPage();
});