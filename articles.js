// articles.js

let allArticles = [];
let selectedArticles = new Set();

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById('articles-container');
    
    // Get saved articles and API key
    const storage = await chrome.storage.local.get(['articles', 'openaiKey']);
    
    if (!storage.articles || storage.articles.length === 0) {
        container.innerHTML = '<div class="no-articles">No saved articles yet.</div>';
        return;
    }

    if (!storage.openaiKey) {
        alert('OpenAI API key not found. Please set it in the extension settings.');
        return;
    }

    // Add Select All checkbox
    const selectAllContainer = document.createElement('div');
    selectAllContainer.className = 'select-all-container';
    selectAllContainer.innerHTML = `
        <label class="checkbox-container">
            <input type="checkbox" id="selectAllCheckbox">
            <span class="checkbox-label">Select All Articles</span>
        </label>
    `;
    container.appendChild(selectAllContainer);

    // Add handler for Select All
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.select-article');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
            const articleId = parseInt(checkbox.dataset.articleId);
            if (selectAllCheckbox.checked) {
                selectedArticles.add(articleId);
            } else {
                selectedArticles.delete(articleId);
            }
        });
    });

    // Sort articles by date (newest first)
    storage.articles.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Display each article
    for (let [index, article] of storage.articles.entries()) {
        const articleElement = document.createElement('div');
        articleElement.className = 'article';
        
        const date = new Date(article.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Create main article content
        const mainContent = document.createElement('div');
        mainContent.className = 'article-main';
        
        // Generate title using OpenAI
        try {
            const generatedTitle = await generateTitle(article.text, storage.openaiKey);
            const articleTitle = generatedTitle || 'Untitled Article';
            
            mainContent.innerHTML = `
                <h2 class="article-title">${articleTitle}</h2>
                <div class="article-date">Saved on ${date}</div>
                <div class="article-content" id="content-${index}">
                    ${article.text}
                </div>
                <button class="expand-btn" data-index="${index}">Show More</button>
            `;
        } catch (error) {
            console.error('Error generating title:', error);
            const articleTitle = article.title?.trim() || 'Untitled Article';
            mainContent.innerHTML = `
                <h2 class="article-title">${articleTitle}</h2>
                <div class="article-date">Saved on ${date}</div>
                <div class="article-content" id="content-${index}">
                    ${article.text}
                </div>
                <button class="expand-btn" data-index="${index}">Show More</button>
            `;
        }

        // Add click handler directly to the button
        const expandBtn = mainContent.querySelector('.expand-btn');
        expandBtn.addEventListener('click', function() {
            const contentId = this.getAttribute('data-index');
            const content = document.getElementById(`content-${contentId}`);
            
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                this.textContent = 'Show More';
                content.scrollTop = 0;
            } else {
                content.classList.add('expanded');
                this.textContent = 'Show Less';
            }
        });

        // Create controls section
        const controls = document.createElement('div');
        controls.className = 'article-controls';
        
        // Replace button with checkbox
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'checkbox-container';
        checkboxContainer.innerHTML = `
            <input type="checkbox" class="select-article" data-article-id="${index}">
            <span class="checkbox-label">Select for Audio</span>
        `;

        const checkbox = checkboxContainer.querySelector('input');
        checkbox.addEventListener('change', () => toggleArticleSelection(index, checkbox));

        controls.appendChild(checkboxContainer);
        
        // Add audio player container (initially empty)
        const audioContainer = document.createElement('div');
        audioContainer.id = `audio-container-${index}`;
        controls.appendChild(audioContainer);

        // Create delete button (new bin icon)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '🗑️'; // Replace this with a different icon if needed
        deleteBtn.addEventListener('click', () => {
            // Remove article from storage and UI
            storage.articles.splice(index, 1); // Remove from array
            chrome.storage.local.set({ articles: storage.articles }); // Update storage
            container.removeChild(articleElement); // Remove from UI
        });

        // Append delete button to the article element
        controls.appendChild(deleteBtn);

        articleElement.appendChild(mainContent);
        articleElement.appendChild(controls);
        container.appendChild(articleElement);
    }

    // Generate Audio button handler
    document.getElementById('generateAudioBtn').addEventListener('click', () => {
        if (selectedArticles.size === 0) {
            alert('Please select at least one article');
            return;
        }
        generateAudioForSelected(storage.articles);
    });
});

function toggleArticleSelection(articleId, checkbox) {
    if (checkbox.checked) {
        selectedArticles.add(articleId);
    } else {
        selectedArticles.delete(articleId);
        // Uncheck Select All if any article is unchecked
        document.getElementById('selectAllCheckbox').checked = false;
    }
    
    // Check if all articles are selected
    const allCheckboxes = document.querySelectorAll('.select-article');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.checked = Array.from(allCheckboxes).every(cb => cb.checked);
}

// Utility function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to generate audio for selected articles
async function generateAudioForSelected(articles) {
    const storage = await chrome.storage.local.get(['openaiKey', 'huggingfaceKey']);
    if (!storage.openaiKey || !storage.huggingfaceKey) {
        alert('API keys not found. Please set them in the extension settings.');
        return;
    }

    const audioPromises = Array.from(selectedArticles).map(async (articleId, index) => {
        const article = articles[articleId];
        const audioContainer = document.getElementById(`audio-container-${articleId}`);
        
        try {
            // Show loading state
            audioContainer.innerHTML = '<div>Generating summary and audio...</div>';

            // 1. Generate summary using OpenAI with retry logic
            const summary = await retryAsync(() => generateSummary(article.text, storage.openaiKey), 3);
            
            // 2. Generate audio using HuggingFace with retry logic
            const audioBlob = await retryAsync(() => generateAudio(summary, storage.huggingfaceKey), 3);
            const audioUrl = URL.createObjectURL(audioBlob);

            // 3. Create summary and audio display
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = `
                <div style="margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                    <strong>Summary:</strong> ${summary}
                </div>
                <audio controls style="width: 100%; margin-top: 10px;">
                    <source src="${audioUrl}" type="audio/wav">
                    Your browser does not support the audio element.
                </audio>
            `;
            
            // Clear previous content and add new elements
            audioContainer.innerHTML = '';
            audioContainer.appendChild(contentDiv);

        } catch (error) {
            console.error('Error generating summary or audio:', error);
            audioContainer.innerHTML = `<div style="color: red;">Error: ${error.message}</div>`;
        }
    });

    // Wait for all audio generation promises to complete
    await Promise.all(audioPromises);
}

// Retry logic for API calls
async function retryAsync(fn, retries) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            console.error(`Attempt ${i + 1} failed: ${error.message}`);
            if (i < retries - 1) {
                await delay(1000); // Wait before retrying
            } else {
                throw new Error('Max retries reached. Please try again later.');
            }
        }
    }
}

async function generateSummary(text, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert summariser. Create a concise structured summary of the following article in about 20 sentences:'
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            max_tokens: 150
        })
    });

    if (!response.ok) {
        throw new Error('Failed to generate summary');
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
}

async function generateAudio(text, apiKey) {
    const response = await fetch(
        "https://api-inference.huggingface.co/models/espnet/kan-bayashi_ljspeech_vits",
        {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({ inputs: text }),
        }
    );

    if (!response.ok) {
        throw new Error('Failed to generate audio');
    }

    return response.blob();
}

async function generateTitle(text, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'Generate a concise, engaging title (maximum 10 words) for this article. Return only the title without quotes or additional text.'
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            max_tokens: 50,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        throw new Error('Failed to generate title');
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
}
