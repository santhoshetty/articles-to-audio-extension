import supabase from './supabaseClient';

let currentSession = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM Content Loaded');
    const container = document.getElementById('articles-container');

    // Initialize session first
    await initializeSession();
    
    if (currentSession) {
        await loadArticles();
    } else {
        console.log('No active session found, cannot load articles.');
        container.innerHTML = '<div class="no-articles">Please sign in to view your articles.</div>';
    }

    // Add Generate Podcast button handler
    const generatePodcastBtn = document.getElementById('generatePodcast');
    console.log('Generate Podcast button:', generatePodcastBtn);
    
    generatePodcastBtn.addEventListener('click', async () => {
        console.log('Generate Podcast button clicked');
        const selectedArticles = document.querySelectorAll('.article-checkbox:checked');
        console.log('Selected articles count:', selectedArticles.length);

        // Check if at least one article is selected
        if (selectedArticles.length === 0) {
            alert('Please select at least one article to generate a podcast.');
            return;
        }

        // Show loading state
        generatePodcastBtn.disabled = true;
        generatePodcastBtn.textContent = 'Generating Script...';
        const loadingIcon = document.getElementById('loadingIcon');
        if (loadingIcon) {
            loadingIcon.style.display = 'inline';
        }

        try {
            const articles = Array.from(selectedArticles).map(checkbox => {
                const articleId = checkbox.dataset.articleId;
                const articleDiv = checkbox.closest('.article');
                
                if (!articleDiv) {
                    console.error('Could not find article div for checkbox:', articleId);
                    throw new Error('Failed to process selected article');
                }

                const title = articleDiv.querySelector('.article-title')?.textContent || 'Untitled';
                const content = articleDiv.querySelector('.article-content')?.textContent || '';
                const summary = articleDiv.querySelector('.article-summary')?.textContent || '';

                console.log('Processing article:', { 
                    id: articleId,
                    title: title,
                    contentLength: content.length,
                    summaryLength: summary.length
                });

                return {
                    id: articleId,
                    title: title,
                    content: content,
                    summary: summary
                };
            });

            console.log('Selected articles:', articles.map(a => a.title).join(', '));

            // Call the new generate-podcast-script function
            console.log('Generating podcast script...');
            const { data: scriptData, error: scriptError } = await supabase.functions.invoke('generate-podcast-script', {
                body: { articles }
            });

            if (scriptError) {
                throw new Error(`Failed to generate podcast script: ${scriptError.message}`);
            }

            console.log('Podcast script generated successfully:', scriptData);

            // Display the podcast script in the frontend
            displayPodcastScript(scriptData.podcast_script, articles);
        } catch (error) {
            console.error('Error generating podcast script:', error);
            alert(`Failed to generate podcast script: ${error.message}`);
        } finally {
            // Reset button state
            generatePodcastBtn.disabled = false;
            generatePodcastBtn.textContent = 'Generate Podcast';
            if (loadingIcon) {
                loadingIcon.style.display = 'none';
            }
        }
    });

    // Add event listener for the All Podcasts button
    document.getElementById('allPodcasts').addEventListener('click', async () => {
        const podcastTable = document.getElementById('podcast-table');
        const podcastList = document.getElementById('podcast-list');

        // Toggle visibility of the podcast table
        if (podcastTable.style.display === 'none') {
            podcastTable.style.display = 'block';
            await loadPodcasts(podcastList); // Load podcasts when opening the table
        } else {
            podcastTable.style.display = 'none';
        }
    });
});

// Session management
async function initializeSession() {
    console.log('Articles page: Initializing session...');
    
    try {
        // First try to get session from background
        const response = await chrome.runtime.sendMessage({ action: "GET_SESSION" });
        if (response?.session) {
            console.log('Articles page: Got session from background:', response.session);
            currentSession = response.session;
            return;
        }
        
        // If no session in background, check Supabase directly
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Articles page: Error getting session:', error.message);
            throw error;
        }
        
        if (session) {
            console.log('Articles page: Session found:', {
                user: session.user.email,
                expires_at: new Date(session.expires_at).toLocaleString()
            });
            currentSession = session;
        } else {
            console.log('Articles page: No session found');
            currentSession = null;
            // Redirect to popup for authentication
            window.close();
        }
    } catch (error) {
        console.error('Articles page: Error in initializeSession:', error);
        console.error('Error stack:', error.stack);
        window.close();
    }
}

// Listen for auth state changes from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AUTH_STATE_CHANGED') {
        console.log('Articles page: Auth state changed:', message.payload.event);
        currentSession = message.payload.session;
        
        if (!currentSession) {
            console.log('Articles page: No session, closing window');
            window.close();
        } else {
            console.log('Articles page: New session, refreshing content');
            loadArticles();
        }
    }
});

// Enhanced article loading with authentication
async function loadArticles() {
    console.log('Articles page: Loading articles...');
    
    if (!currentSession) {
        console.error('Articles page: Attempting to load articles without authentication');
        const container = document.getElementById('articles-container');
        container.innerHTML = '<div class="no-articles">Please sign in to view your articles.</div>';
        return;
    }
    
    try {
        console.log('Articles page: Current session user:', currentSession.user.id);
        
        const { data: articles, error } = await supabase
            .from('articles')
            .select('*')
            .eq('user_id', currentSession.user.id)
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('Articles page: Error loading articles:', error.message);
            console.error('Full error:', error);
            const container = document.getElementById('articles-container');
            container.innerHTML = '<div class="no-articles">Error loading articles. Please try again.</div>';
            return;
        }
        
        if (!articles || articles.length === 0) {
            console.log('Articles page: No articles found for user');
            const container = document.getElementById('articles-container');
            container.innerHTML = '<div class="no-articles">No saved articles yet.</div>';
            return;
        }
        
        console.log(`Articles page: Loaded ${articles.length} articles:`, articles);
        
        // Map database fields to display fields
        const mappedArticles = articles.map(article => ({
            id: article.id,
            title: article.title,
            content: article.content || article.text, // Handle both content and text fields
            created_at: article.created_at,
            summary: article.summary
        }));
        
        // Store articles in a global variable for date filtering
        window.articlesData = mappedArticles;
        
        displayArticles(mappedArticles);
        
        // Set up date filtering after articles are loaded
        setupDateFiltering();
    } catch (error) {
        console.error('Articles page: Error in loadArticles:', error);
        console.error('Error stack:', error.stack);
        const container = document.getElementById('articles-container');
        container.innerHTML = '<div class="no-articles">Error loading articles. Please try again.</div>';
    }
}

// Setup date filtering functionality
function setupDateFiltering() {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    if (!startDateInput || !endDateInput) {
        console.error('Date filter inputs not found in the DOM');
        return;
    }
    
    // Function to filter articles by date
    const filterArticlesByDate = () => {
        console.log('Filtering articles by date');
        
        if (!window.articlesData) {
            console.error('No articles data available for filtering');
            return;
        }
        
        const startDate = startDateInput.value ? new Date(startDateInput.value) : null;
        const endDate = endDateInput.value ? new Date(endDateInput.value) : null;
        
        // If both inputs are empty, show all articles
        if (!startDate && !endDate) {
            document.querySelectorAll('.article').forEach(article => {
                article.style.display = '';
            });
            return;
        }
        
        // Add one day to end date to include the selected day
        if (endDate) {
            endDate.setDate(endDate.getDate() + 1);
        }
        
        document.querySelectorAll('.article').forEach((article, index) => {
            if (index >= window.articlesData.length) return;
            
            const articleDate = new Date(window.articlesData[index].created_at);
            let showArticle = true;
            
            if (startDate && articleDate < startDate) {
                showArticle = false;
            }
            
            if (endDate && articleDate > endDate) {
                showArticle = false;
            }
            
            article.style.display = showArticle ? '' : 'none';
        });
        
        // Update Select All checkbox to only consider visible articles
        updateSelectAllCheckbox();
    };
    
    // Attach event listeners to filter articles when dates change
    startDateInput.addEventListener('change', filterArticlesByDate);
    endDateInput.addEventListener('change', filterArticlesByDate);
}

// Function to update the Select All checkbox state based on visible articles
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (!selectAllCheckbox) return;
    
    const visibleArticles = Array.from(document.querySelectorAll('.article'))
        .filter(article => article.style.display !== 'none');
    
    const visibleCheckboxes = visibleArticles
        .map(article => article.querySelector('.article-checkbox'))
        .filter(checkbox => checkbox !== null);
    
    // If all visible checkboxes are checked, check the Select All checkbox
    selectAllCheckbox.checked = visibleCheckboxes.length > 0 && 
        visibleCheckboxes.every(checkbox => checkbox.checked);
}

let allArticles = [];
let selectedArticles = new Set();

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById('articles-container');

    // Get saved articles
    const storage = await chrome.storage.local.get(['articles']);

    if (!storage.articles || storage.articles.length === 0) {
        container.innerHTML = '<div class="no-articles">No saved articles yet.</div>';
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
        const articles = document.querySelectorAll('.article');
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(endDateInput.value);

        checkboxes.forEach((checkbox, index) => {
            const articleDate = new Date(storage.articles[index].created_at); // Access the date from storage

            // Check if the article date is within the selected range
            if (articleDate >= startDate && articleDate <= endDate) {
                checkbox.checked = selectAllCheckbox.checked; // Check or uncheck based on Select All
                const articleId = parseInt(checkbox.dataset.articleId);
                if (selectAllCheckbox.checked) {
                    selectedArticles.add(articleId);
                } else {
                    selectedArticles.delete(articleId);
                }
            } else {
                checkbox.checked = false; // Uncheck if not in date range
            }
        });
    });

    // Sort articles by date (newest first)
    storage.articles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Display each article
    for (let [index, article] of storage.articles.entries()) {
        const articleElement = document.createElement('div');
        articleElement.className = 'article';

        const date = new Date(article.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Create main article content
        const mainContent = document.createElement('div');
        mainContent.className = 'article-main';

        // Check if the article already has a title
        const existingTitle = article.title?.trim();
        let articleTitle = existingTitle || 'Untitled Article';

        // Generate title using OpenAI only if it doesn't exist
        if (!existingTitle) {
            try {
                const generatedTitle = await generateTitle(article.text);
                articleTitle = generatedTitle || 'Untitled Article';
            } catch (error) {
                console.error('Error generating title:', error);
            }
        }

        mainContent.innerHTML = `
            <h2 class="article-title">${articleTitle}</h2>
            <div class="article-date">Saved on ${date}</div>
            <div class="article-content" id="content-${index}">
                ${article.text}
            </div>
            <button class="expand-btn" data-index="${index}">Show More</button>
            <button class="generate-summary-btn" data-index="${index}">${article.summary ? 'Re-generate Summary' : 'Generate Summary'}</button>
            <div class="article-summary" id="summary-${index}"></div>
        `;

        // Add click handler for the Generate/Re-generate Summary button
        const generateSummaryBtn = mainContent.querySelector('.generate-summary-btn');
        console.log('Adding click handler to summary button:', generateSummaryBtn);
        generateSummaryBtn.addEventListener('click', async () => {
            console.log('Summary button clicked!');
            try {
                if (!currentSession) {
                    console.error('No active session found');
                    throw new Error('Please sign in to generate summaries');
                }

                console.log('Starting summary generation for article:', {
                    title: articleTitle,
                    textLength: article.content?.length || article.text?.length || 0,
                    hasContent: !!article.content,
                    hasText: !!article.text,
                    articleData: article
                });

                if (!article.content && !article.text) {
                    throw new Error('No article text found to generate summary');
                }

                // Show loading state
                generateSummaryBtn.disabled = true;
                generateSummaryBtn.textContent = 'Generating...';
                
                const summary = await generateSummary(article.content || article.text);
                console.log('Summary generated successfully:', {
                    summaryLength: summary.length,
                    summary: summary.substring(0, 100) + '...' // Log first 100 chars
                });

                const summaryElement = mainContent.querySelector(`.article-summary#summary-${index}`);
                summaryElement.style.display = 'block';
                summaryElement.innerHTML = `<strong>Summary:</strong> ${summary}`;
                
                // Update the summary in storage
                article.summary = summary;
                
                // Update in Supabase if we have an article ID
                if (article.id) {
                    console.log('Saving summary to database for article:', article.id);
                    const { error } = await supabase
                        .from('articles')
                        .update({ summary })
                        .eq('id', article.id);
                        
                    if (error) {
                        console.error('Error saving summary to database:', error);
                        throw error;
                    }
                    console.log('Summary saved to database successfully');
                }

                // Update button text to show success
                generateSummaryBtn.textContent = 'Re-generate Summary';
            } catch (error) {
                console.error('Error in summary generation:', error);
                alert('Failed to generate summary: ' + error.message);
                generateSummaryBtn.textContent = 'Generate Summary';
            } finally {
                generateSummaryBtn.disabled = false;
            }
        });

        // Add click handler directly to the button
        const expandBtn = mainContent.querySelector('.expand-btn');
        expandBtn.addEventListener('click', function () {
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
            <input type="checkbox" class="select-article article-checkbox" data-article-id="${index}">
            <span class="checkbox-label">Select for Podcast</span>
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

        // Create summary element
        const summaryElement = document.createElement('div');
        summaryElement.className = 'article-summary';
        summaryElement.id = `summary-${index}`;
        summaryElement.innerHTML = `<strong>Summary:</strong> ${article.summary || 'No summary available.'}`; // Populate summary
        summaryElement.style.display = 'none'; // Initially hide the summary
        mainContent.appendChild(summaryElement); // Append summary to main content

        // Create Show/Hide Summary button if a summary exists
        if (article.summary) {
            const showHideSummaryBtn = document.createElement('button');
            showHideSummaryBtn.className = 'show-hide-summary-btn';
            showHideSummaryBtn.textContent = 'Show Summary'; // Initial button text
            mainContent.appendChild(showHideSummaryBtn);

            // Add click handler for the Show/Hide Summary button
            showHideSummaryBtn.addEventListener('click', () => {
                console.log('Button clicked'); // Debugging line
                if (summaryElement.style.display === 'none') {
                    summaryElement.style.display = 'block'; // Show the summary
                    showHideSummaryBtn.textContent = 'Hide Summary'; // Update button text
                } else {
                    summaryElement.style.display = 'none'; // Hide the summary
                    showHideSummaryBtn.textContent = 'Show Summary'; // Update button text
                }
            });
        }

        articleElement.appendChild(mainContent);
        articleElement.appendChild(controls);
        container.appendChild(articleElement);
    }

    // Add event listener for the All Podcasts button
    document.getElementById('allPodcasts').addEventListener('click', async () => {
        const podcastTable = document.getElementById('podcast-table');
        const podcastList = document.getElementById('podcast-list');

        // Toggle visibility of the podcast table
        if (podcastTable.style.display === 'none') {
            podcastTable.style.display = 'block';
            await loadPodcasts(podcastList); // Load podcasts when opening the table
        } else {
            podcastTable.style.display = 'none';
        }
    });
});

function toggleArticleSelection(articleId, checkbox) {
    if (checkbox.checked) {
        selectedArticles.add(articleId);
    } else {
        selectedArticles.delete(articleId);
    }

    // Update Select All checkbox state
    updateSelectAllCheckbox();
}

// Utility function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function generateSummary(text) {
    try {
        const { data, error } = await supabase.functions.invoke('generate-summary', {
            body: { text }
        });

        if (error) {
            throw error;
        }

        return data.summary;
    } catch (error) {
        console.error('Error generating summary:', error);
        throw error;
    }
}

async function generateAudio(text, voice = "alloy") {
    try {
        const { data, error } = await supabase.functions.invoke('generate-audio', {
            body: { text, voice }
        });

        if (error) {
            throw error;
        }

        // Convert base64 to blob
        const audioBlob = await fetch(`data:audio/mp3;base64,${data.audio}`).then(res => res.blob());
        console.log("✅ Audio generated successfully!");
        return audioBlob;
    } catch (error) {
        console.error('Error generating audio:', error);
        throw error;
    }
}

async function generateTitle(text) {
    try {
        const { data, error } = await supabase.functions.invoke('generate-title', {
            body: { text }
        });

        if (error) {
            throw error;
        }

        return data.title;
    } catch (error) {
        console.error('Error generating title:', error);
        throw error;
    }
}

async function generateConversationScript(articles) {
    try {
        const { data, error } = await supabase.functions.invoke('generate-conversation', {
            body: { articles }
        });

        if (error) {
            throw error;
        }

        return parseConversationScript(data.conversation);
    } catch (error) {
        console.error('Error generating conversation script:', error);
        throw error;
    }
}

async function generateSpeechAudio(textLines, voice) {
    console.log(`Generating audio for ${textLines.length} lines with voice '${voice}'`);

    // Generate audio for each line separately using generateAudio
    const audioPromises = textLines.map(async (line) => {
        return await generateAudio(line, voice); // Call generateAudio for each line
    });

    // Wait for all audio generations to complete
    const audioBlobs = await Promise.all(audioPromises);
    console.log(`Generated ${audioBlobs.length} audio segments`);
    return audioBlobs; // Return the array of audio blobs
}

async function combineAudioTracks(audioBlobs1, audioBlobs2, conversation) {
    if (typeof window === 'undefined') {
        throw new Error('Audio context is not available in this environment');
    }

    try {
        console.log('🎙️ Starting podcast audio combination...');
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Convert all blobs to audio buffers
        console.log('🔄 Converting blobs to audio buffers...');
        const convertBlobToBuffer = async (blob) => {
            const arrayBuffer = await blob.arrayBuffer();
            return await audioContext.decodeAudioData(arrayBuffer);
        };

        const speaker1Buffers = await Promise.all(audioBlobs1.map(convertBlobToBuffer));
        const speaker2Buffers = await Promise.all(audioBlobs2.map(convertBlobToBuffer));

        // Calculate total duration
        const getTotalDuration = (buffers) => buffers.reduce((sum, buf) => sum + buf.duration, 0);
        const pauseDuration = 0.3;
        const totalDuration = getTotalDuration(speaker1Buffers) + 
                            getTotalDuration(speaker2Buffers) + 
                            (pauseDuration * 2 * Math.max(speaker1Buffers.length, speaker2Buffers.length));

        console.log('📊 Buffer details:', {
            speaker1Lines: speaker1Buffers.length,
            speaker2Lines: speaker2Buffers.length,
            totalDuration,
            sampleRate: audioContext.sampleRate
        });

        // Create final buffer
        const finalBuffer = audioContext.createBuffer(
            1,
            Math.ceil(audioContext.sampleRate * totalDuration),
            audioContext.sampleRate
        );
        const targetData = finalBuffer.getChannelData(0);

        // Helper to copy a buffer at a specific position
        const copyBuffer = (sourceBuffer, targetPosition) => {
            const sourceData = sourceBuffer.getChannelData(0);
            const offsetSamples = Math.floor(targetPosition * audioContext.sampleRate);
            targetData.set(sourceData, offsetSamples);
            return sourceBuffer.duration;
        };

        // Helper to add silence
        const addPause = (duration, targetPosition) => {
            const offsetSamples = Math.floor(targetPosition * audioContext.sampleRate);
            const pauseSamples = Math.floor(duration * audioContext.sampleRate);
            targetData.fill(0, offsetSamples, offsetSamples + pauseSamples);
            return duration;
        };

        // Interleave the audio segments
        let currentPosition = 0;
        const lineCount = Math.max(speaker1Buffers.length, speaker2Buffers.length);

        for (let i = 0; i < lineCount; i++) {
            console.log(`🔄 Processing dialogue line ${i + 1} of ${lineCount}`);

            if (speaker1Buffers[i]) {
                currentPosition += copyBuffer(speaker1Buffers[i], currentPosition);
                currentPosition += addPause(pauseDuration, currentPosition);
            }

            if (speaker2Buffers[i]) {
                currentPosition += copyBuffer(speaker2Buffers[i], currentPosition);
                currentPosition += addPause(pauseDuration, currentPosition);
            }
        }

        // Create and return the final audio
        console.log('🎤 Creating final media stream...');
        const source = audioContext.createBufferSource();
        source.buffer = finalBuffer;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);

        const mediaRecorder = new MediaRecorder(destination.stream);
        const chunks = [];

        return new Promise((resolve) => {
            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = () => {
                const finalBlob = new Blob(chunks, { type: 'audio/wav' });
                console.log('🎙️ Final podcast size:', finalBlob.size, 'bytes');
                resolve(finalBlob);
            };

            source.start(0);
            mediaRecorder.start();

            setTimeout(() => {
                mediaRecorder.stop();
                source.stop();
            }, finalBuffer.duration * 1000);
        });

    } catch (error) {
        console.error('❌ Error combining audio tracks:', error);
        throw new Error('Failed to combine audio tracks: ' + error.message);
    }
}

async function playPodcast(audioBlob) {
    if (!(audioBlob instanceof Blob)) {
        console.error('Invalid audio blob:', audioBlob);
        alert('Failed to play podcast. Invalid audio data.');
        return;
    }

    const audio = new Audio(URL.createObjectURL(audioBlob));
    audio.play();
}

// Function to parse the conversation script
function parseConversationScript(script) {
    // Split by line breaks and remove empty lines
    const lines = script.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => line.trim());
    
    const speaker1Lines = [];
    const speaker2Lines = [];
    
    // Parse each line and distribute to appropriate speaker
    lines.forEach(line => {
        // Remove the host marker from the actual text
        const cleanedLine = line.replace(/^(Host ?[12]:?\s*)/i, '').trim();
        
        if (line.match(/^Host ?1:?/i)) {
            speaker1Lines.push(cleanedLine);
        } else if (line.match(/^Host ?2:?/i)) {
            speaker2Lines.push(cleanedLine);
        }
    });

    return {
        speaker1Lines,
        speaker2Lines
    };
}

// Function to save audio file in IndexedDB
async function saveAudioFile(id, audioBlob) {
    const db = await openDb();
    const tx = db.transaction("audioFiles", "readwrite");
    const store = tx.objectStore("audioFiles");

    // Log the audioBlob to ensure it's not null
    console.log("Saving audioBlob with ID:", id, audioBlob);

    // Save the audio file in IndexedDB
    await store.put({ id, audioBlob }); // Ensure the structure is correct
    return tx.complete;
}

// Function to open IndexedDB
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("MyExtensionDB", 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("audioFiles")) {
                db.createObjectStore("audioFiles", { keyPath: "id" });
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

// Function to retrieve audio from IndexedDB
async function getAudioFile(id) {
    return new Promise((resolve, reject) => {
        const dbRequest = openDb(); // Open the database
        dbRequest.then(db => {
            const tx = db.transaction("audioFiles", "readonly");
            const store = tx.objectStore("audioFiles");
            const audioRequest = store.get(id);

            audioRequest.onsuccess = (event) => {
                const audioFile = event.target.result; // Get the result from the event
                if (!audioFile) {
                    resolve(null); // Return null if no audio file found
                } else {
                    console.log("Retrieved audioFile ID:", id);
                    resolve(audioFile.audioBlob); // Resolve with the audioBlob
                }
            };

            audioRequest.onerror = (event) => {
                reject(new Error("Failed to retrieve audio file from IndexedDB."));
            };
        }).catch(reject); // Handle any errors opening the database
    });
}

// Function to load podcasts and populate the table
async function loadPodcasts(podcastList) {
    if (!currentSession?.user?.id) {
        console.error('No authenticated user found');
        alert('Please sign in to view your podcasts');
        return;
    }

    // Remove table headers, just start with empty tbody
    podcastList.innerHTML = '';

    try {
        console.log('Fetching podcasts for user:', currentSession.user.id);
        
        // Get all unique audio_ids and their associated articles for the user
        const { data: audioFiles, error: audioError } = await supabase
            .from('article_audio')
            .select(`
                audio_id,
                audio_files (
                    file_url
                ),
                articles (
                    title
                )
            `)
            .eq('user_id', currentSession.user.id)
            .order('audio_id', { ascending: false });

        if (audioError) {
            console.error('Error fetching audio files:', audioError);
            throw audioError;
        }

        // Group by audio_id to get all articles for each podcast
        const podcastGroups = audioFiles.reduce((groups, entry) => {
            if (!groups[entry.audio_id]) {
                groups[entry.audio_id] = {
                    id: entry.audio_id,
                    file_url: entry.audio_files?.file_url,
                    articles: []
                };
            }
            if (entry.articles?.title) {
                groups[entry.audio_id].articles.push(entry.articles.title);
            }
            return groups;
        }, {});

        console.log('Grouped podcasts:', podcastGroups);

        // Keep track of currently playing audio
        let currentlyPlaying = null;

        // Create table rows for each podcast
        for (const podcast of Object.values(podcastGroups)) {
            if (!podcast.file_url) continue; // Skip if no audio URL

            const row = document.createElement('tr');
            
            // Create play button cell
            const playCell = document.createElement('td');
            const playBtn = document.createElement('button');
            playBtn.className = 'podcast-play-btn';
            playBtn.innerHTML = '▶️';
            playBtn.dataset.playing = 'false';

            // Create audio element (but don't set src until play is clicked)
            const audio = new Audio();
            
            // Handle play/pause
            playBtn.addEventListener('click', async () => {
                if (currentlyPlaying && currentlyPlaying !== audio) {
                    currentlyPlaying.pause();
                    currentlyPlaying.currentTime = 0;
                    // Reset other play buttons
                    document.querySelectorAll('.podcast-play-btn').forEach(btn => {
                        if (btn !== playBtn) {
                            btn.innerHTML = '▶️';
                            btn.dataset.playing = 'false';
                        }
                    });
                }

                if (audio.paused) {
                    // Only get signed URL and set source when playing for the first time
                    if (!audio.src) {
                        try {
                            // Get the file name from the URL
                            const audioUrlPath = new URL(podcast.file_url).pathname;
                            const fileName = audioUrlPath.split('/').pop();
                            
                            // Get signed URL
                            const { data: signedUrlData, error: signedUrlError } = await supabase
                                .storage
                                .from('audio-files')
                                .createSignedUrl(`public/${fileName}`, 604800); // 7 days expiry

                            if (signedUrlError) {
                                console.error('Failed to get signed URL:', signedUrlError);
                                throw signedUrlError;
                            }

                            audio.src = signedUrlData.signedUrl;
                        } catch (error) {
                            console.error('Error getting signed URL:', error);
                            alert('Failed to load audio. Please try again.');
                            return;
                        }
                    }
                    audio.play();
                    playBtn.innerHTML = '⏸️';
                    playBtn.dataset.playing = 'true';
                    currentlyPlaying = audio;
                } else {
                    audio.pause();
                    playBtn.innerHTML = '▶️';
                    playBtn.dataset.playing = 'false';
                    currentlyPlaying = null;
                }
            });

            // Handle audio ending
            audio.addEventListener('ended', () => {
                playBtn.innerHTML = '▶️';
                playBtn.dataset.playing = 'false';
                currentlyPlaying = null;
            });

            playCell.appendChild(playBtn);
            row.appendChild(playCell);

            // Create articles cell with list
            const articlesCell = document.createElement('td');
            const articlesList = document.createElement('ul');
            articlesList.style.margin = '0';
            articlesList.style.paddingLeft = '20px';
            
            podcast.articles.forEach(title => {
                const li = document.createElement('li');
                li.textContent = title;
                articlesList.appendChild(li);
            });
            
            articlesCell.appendChild(articlesList);
            row.appendChild(articlesCell);

            podcastList.appendChild(row);
        }

        if (podcastList.children.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="2" style="text-align: center;">No podcasts found</td>';
            podcastList.appendChild(emptyRow);
        }

    } catch (error) {
        console.error('Error loading podcasts:', error);
        alert('Failed to load podcasts. Please try again.');
    }
}

// Function to display articles
async function displayArticles(articles) {
    console.log('Articles page: Displaying articles:', articles);
    const container = document.getElementById('articles-container');
    container.innerHTML = ''; // Clear existing content

    if (!articles || articles.length === 0) {
        container.innerHTML = '<div class="no-articles">No saved articles yet.</div>';
        return;
    }

    // Check for existing podcasts for all articles
    const { data: existingPodcasts, error: podcastError } = await supabase
        .from('article_audio')
        .select(`
            article_id,
            audio_id,
            audio_files (
                file_url
            )
        `)
        .in('article_id', articles.map(a => a.id));

    if (podcastError) {
        console.error('Error fetching existing podcasts:', podcastError);
    }

    // Create a map of article IDs to their audio URLs
    const articleAudioMap = {};
    if (existingPodcasts) {
        existingPodcasts.forEach(entry => {
            if (entry.audio_files?.file_url) {
                articleAudioMap[entry.article_id] = entry.audio_files.file_url;
            }
        });
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

    // Add Select All handler
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.addEventListener('change', () => {
        // Only select visible articles
        const visibleArticles = Array.from(document.querySelectorAll('.article'))
            .filter(article => article.style.display !== 'none');
        
        visibleArticles.forEach(article => {
            const checkbox = article.querySelector('.article-checkbox');
            if (checkbox) {
                checkbox.checked = selectAllCheckbox.checked;
                
                // Update selectedArticles set
                const articleId = checkbox.dataset.articleId;
                if (selectAllCheckbox.checked) {
                    selectedArticles.add(articleId);
                } else {
                    selectedArticles.delete(articleId);
                }
            }
        });
    });

    // Display each article
    articles.forEach((article, index) => {
        const articleElement = document.createElement('div');
        articleElement.className = 'article';

        const date = new Date(article.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Create main article content
        const mainContent = document.createElement('div');
        mainContent.className = 'article-main';

        const articleTitle = article.title || 'Untitled Article';

        mainContent.innerHTML = `
            <h2 class="article-title">${articleTitle}</h2>
            <div class="article-date">Saved on ${date}</div>
            <div class="article-content" id="content-${index}">
                ${article.content}
            </div>
            <button class="expand-btn" data-index="${index}">Show More</button>
            <button class="generate-summary-btn" data-index="${index}">${article.summary ? 'Re-generate Summary' : 'Generate Summary'}</button>
            <div class="article-summary" id="summary-${index}">${article.summary ? `<strong>Summary:</strong> ${article.summary}` : ''}</div>
        `;

        // Create controls section
        const controls = document.createElement('div');
        controls.className = 'article-controls';

        // Add checkbox for podcast selection
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'checkbox-container';
        checkboxContainer.innerHTML = `
            <input type="checkbox" class="select-article article-checkbox" data-article-id="${article.id}">
            <span class="checkbox-label">Select for Podcast</span>
        `;

        controls.appendChild(checkboxContainer);

        // Add audio player container
        const audioContainer = document.createElement('div');
        audioContainer.id = `audio-container-${index}`;
        controls.appendChild(audioContainer);

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.addEventListener('click', async () => {
            try {
                const { error } = await supabase
                    .from('articles')
                    .delete()
                    .eq('id', article.id);

                if (error) throw error;
                
                container.removeChild(articleElement);
                if (container.children.length === 0) {
                    container.innerHTML = '<div class="no-articles">No saved articles yet.</div>';
                }
            } catch (error) {
                console.error('Error deleting article:', error);
                alert('Failed to delete article. Please try again.');
            }
        });

        controls.appendChild(deleteBtn);

        // Add expand button handler
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

        // Add summary button handler
        const generateSummaryBtn = mainContent.querySelector('.generate-summary-btn');
        generateSummaryBtn.addEventListener('click', async () => {
            try {
                if (!currentSession) {
                    throw new Error('Please sign in to generate summaries');
                }

                generateSummaryBtn.disabled = true;
                generateSummaryBtn.textContent = 'Generating...';
                
                const summary = await generateSummary(article.content);
                const summaryElement = mainContent.querySelector(`.article-summary#summary-${index}`);
                summaryElement.style.display = 'block';
                summaryElement.innerHTML = `<strong>Summary:</strong> ${summary}`;
                
                // Update the summary in storage and database
                article.summary = summary;
                const { error } = await supabase
                    .from('articles')
                    .update({ summary })
                    .eq('id', article.id);

                if (error) throw error;
                
                generateSummaryBtn.textContent = 'Re-generate Summary';
            } catch (error) {
                console.error('Error in summary generation:', error);
                alert('Failed to generate summary: ' + error.message);
                generateSummaryBtn.textContent = 'Generate Summary';
            } finally {
                generateSummaryBtn.disabled = false;
            }
        });

        articleElement.appendChild(mainContent);
        articleElement.appendChild(controls);
        container.appendChild(articleElement);
    });

    // Add event listener for saving a new article
    const saveArticle = async (article) => {
        console.log('Attempting to save article:', article); // Debugging line

        // Generate title if it doesn't exist
        if (!article.title) {
            try {
                console.log('Generating title for article text:', article.text); // Debugging line
                const generatedTitle = await generateTitle(article.text);
                article.title = generatedTitle || 'Untitled Article';
            } catch (error) {
                console.error('Error generating title:', error);
                article.title = 'Untitled Article'; // Fallback if title generation fails
            }
        }

        // Save the article to storage
        storage.articles.push(article);
        await chrome.storage.local.set({ articles: storage.articles });

        // Now save the article to Supabase, including the title
        const { error } = await supabase
            .from('articles')
            .insert(article);

        if (error) {
            console.error('Error saving article to Supabase:', error);
            throw error;
        }
    };

    // Assuming this is part of your article submission logic
    document.getElementById('saveArticleButton').addEventListener('click', async () => {
        const articleText = document.getElementById('articleTextArea').value; // Get the article text from a textarea
        const newArticle = {
            text: articleText,
            // other properties if needed
        };

        try {
            await saveArticle(newArticle); // Call the saveArticle function
            console.log('Article saved successfully:', newArticle);
        } catch (error) {
            console.error('Error saving article:', error);
        }
    });
}

// Function to display the podcast script in the frontend
function displayPodcastScript(script, articles) {
    console.log('Displaying podcast script');
    
    // Remove any existing script container
    const existingContainer = document.getElementById('podcast-script-container');
    if (existingContainer) {
        existingContainer.remove();
    }
    
    // Create a container for the script
    const scriptContainer = document.createElement('div');
    scriptContainer.id = 'podcast-script-container';
    scriptContainer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 80%;
        max-width: 800px;
        max-height: 80vh;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        padding: 20px;
        z-index: 2000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;
    
    // Create a header
    const header = document.createElement('div');
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid #eee;
    `;
    
    // Add title
    const title = document.createElement('h2');
    title.textContent = 'Podcast Script';
    title.style.margin = '0';
    header.appendChild(title);
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #555;
    `;
    closeButton.addEventListener('click', () => {
        scriptContainer.remove();
        overlay.remove();
    });
    header.appendChild(closeButton);
    
    // Add articles info
    const articlesInfo = document.createElement('div');
    articlesInfo.style.cssText = `
        margin-bottom: 15px;
        font-size: 14px;
        color: #555;
    `;
    articlesInfo.textContent = `Articles: ${articles.map(a => a.title).join(', ')}`;
    
    // Create script content area with scroll
    const scriptContent = document.createElement('div');
    scriptContent.style.cssText = `
        white-space: pre-wrap;
        overflow-y: auto;
        flex-grow: 1;
        padding: 15px;
        background-color: #f9f9f9;
        border-radius: 4px;
        line-height: 1.6;
        font-family: 'Arial', sans-serif;
    `;
    
    // Process the script to format Alice and Bob's lines
    const formattedScript = script.split('\n').map(line => {
        if (line.startsWith('Alice:')) {
            return `<div style="color: #0066cc;"><strong>${line}</strong></div>`;
        } else if (line.startsWith('Bob:')) {
            return `<div style="color: #cc6600;"><strong>${line}</strong></div>`;
        }
        return `<div>${line}</div>`;
    }).join('');
    
    scriptContent.innerHTML = formattedScript;
    
    // Add progress indicator for audio processing
    const progressContainer = document.createElement('div');
    progressContainer.id = 'podcast-progress-container';
    progressContainer.style.cssText = `
        margin-top: 15px;
        padding: 10px;
        background-color: #f0f0f0;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;
    
    const progressStatus = document.createElement('div');
    progressStatus.id = 'podcast-progress-status';
    progressStatus.textContent = 'Processing audio chunks...';
    progressStatus.style.cssText = `
        font-size: 14px;
        color: #333;
    `;
    
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        width: 100%;
        height: 8px;
        background-color: #ddd;
        border-radius: 4px;
        overflow: hidden;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.id = 'podcast-progress-fill';
    progressFill.style.cssText = `
        width: 0%;
        height: 100%;
        background-color: #4CAF50;
        transition: width 0.5s ease;
    `;
    
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressStatus);
    progressContainer.appendChild(progressBar);
    
    // Add copy button
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Script';
    copyButton.style.cssText = `
        align-self: flex-start;
        margin-top: 15px;
        padding: 8px 16px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    `;
    copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(script)
            .then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy Script';
                }, 2000);
            })
            .catch(err => {
                console.error('Failed to copy script:', err);
                alert('Failed to copy script. Please try again.');
            });
    });
    
    // Assemble the container
    scriptContainer.appendChild(header);
    scriptContainer.appendChild(articlesInfo);
    scriptContainer.appendChild(scriptContent);
    scriptContainer.appendChild(progressContainer);
    scriptContainer.appendChild(copyButton);
    
    // Add to the document
    document.body.appendChild(scriptContainer);
    
    // Add an overlay behind the script container
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 1999;
    `;
    overlay.addEventListener('click', () => {
        overlay.remove();
        scriptContainer.remove();
    });
    document.body.appendChild(overlay);
    
    // Generate a unique ID for this podcast
    const podcastId = crypto.randomUUID();
    const scriptId = crypto.randomUUID();
    
    // Calculate podcast length based on PRD formula
    // (4 minutes × number of articles) + 2 minutes
    const podcastLengthMinutes = (4 * articles.length) + 2;
    
    // Start audio processing
    (async () => {
        try {
            // Call the process-podcast-audio edge function
            const { data: audioData, error: audioError } = await supabase.functions.invoke('process-podcast-audio', {
                body: { 
                    podcastScript: script,
                    scriptId: scriptId,
                    podcastId: podcastId,
                    podcastLengthMinutes: podcastLengthMinutes
                }
            });
            
            if (audioError) {
                throw new Error(`Failed to start audio processing: ${audioError.message}`);
            }
            
            console.log('Audio processing started:', audioData);
            
            // Set up interval to check processing status
            const jobId = audioData.jobId;
            const checkProgressInterval = setInterval(async () => {
                try {
                    // Check job status
                    const { data: jobData, error: jobError } = await supabase
                        .from('podcast_jobs')
                        .select('status, total_chunks, completed_chunks, error')
                        .eq('id', jobId)
                        .single();
                    
                    if (jobError) {
                        throw new Error(`Failed to check processing status: ${jobError.message}`);
                    }
                    
                    if (!jobData) {
                        throw new Error('Job not found');
                    }
                    
                    // Also verify chunk status for more accurate reporting
                    const { data: chunkData, error: chunkError } = await supabase
                        .from('podcast_chunks')
                        .select('status, audio_url')
                        .eq('job_id', jobId);
                        
                    if (chunkError) {
                        console.warn(`Could not verify chunk status: ${chunkError.message}`);
                    }
                    
                    // Use the most accurate count we have
                    let completedChunks = jobData.completed_chunks;
                    let totalChunks = jobData.total_chunks;
                    
                    // If we have chunk data, use it to verify
                    if (chunkData) {
                        const actualCompleted = chunkData.filter(chunk => chunk.status === 'completed' && chunk.audio_url).length;
                        
                        // Check for mismatch and use the more conservative value
                        if (actualCompleted !== completedChunks) {
                            console.warn(`Mismatch in completed chunks: job says ${completedChunks}, chunks show ${actualCompleted}`);
                            // Use the smaller value to avoid showing incorrect completion
                            completedChunks = Math.min(actualCompleted, completedChunks);
                        }
                        
                        // Double-check total chunks
                        if (chunkData.length !== totalChunks) {
                            console.warn(`Mismatch in total chunks: job says ${totalChunks}, found ${chunkData.length}`);
                            // Use the larger value to avoid showing incorrect completion
                            totalChunks = Math.max(chunkData.length, totalChunks);
                        }
                    }
                    
                    // Calculate progress safely
                    let progress = 0;
                    if (totalChunks > 0) {
                        progress = (completedChunks / totalChunks) * 100;
                        // Cap at 100%
                        progress = Math.min(progress, 100);
                    }
                    
                    const progressFill = document.getElementById('podcast-progress-fill');
                    const progressStatus = document.getElementById('podcast-progress-status');
                    
                    if (progressFill && progressStatus) {
                        progressFill.style.width = `${progress}%`;
                        
                        if (jobData.status === 'completed') {
                            // Verify all chunks have audio URLs before declaring completion
                            let allChunksHaveAudio = true;
                            
                            if (chunkData) {
                                const expectedChunkCount = totalChunks;
                                const chunksWithAudio = chunkData.filter(chunk => chunk.status === 'completed' && chunk.audio_url).length;
                                
                                if (chunksWithAudio < expectedChunkCount) {
                                    allChunksHaveAudio = false;
                                    console.warn(`Only ${chunksWithAudio} of ${expectedChunkCount} chunks have audio files`);
                                }
                            }
                            
                            if (allChunksHaveAudio) {
                                progressStatus.textContent = 'Audio processing complete!';
                                progressStatus.style.color = '#4CAF50';
                                clearInterval(checkProgressInterval);
                                
                                // TODO: Add button to play or download the final podcast
                            } else {
                                // Some chunks are missing audio
                                progressStatus.textContent = 'Completed, but some audio segments are missing. Please try again.';
                                progressStatus.style.color = '#FF9800';  // Warning color
                                clearInterval(checkProgressInterval);
                            }
                        } else if (jobData.status === 'completed_with_errors') {
                            progressStatus.textContent = `Processing complete with some errors: ${jobData.error || 'Some chunks failed'}`;
                            progressStatus.style.color = '#FF9800';  // Warning color
                            clearInterval(checkProgressInterval);
                        } else if (jobData.status === 'error') {
                            progressStatus.textContent = `Error: ${jobData.error || 'Processing failed'}`;
                            progressStatus.style.color = '#f44336';
                            clearInterval(checkProgressInterval);
                        } else {
                            progressStatus.textContent = `Processing audio chunks... (${Math.round(progress)}%)`;
                        }
                    } else {
                        // Progress elements no longer exist, user probably closed the dialog
                        clearInterval(checkProgressInterval);
                    }
                } catch (error) {
                    console.error('Error checking processing status:', error);
                    const progressStatus = document.getElementById('podcast-progress-status');
                    if (progressStatus) {
                        progressStatus.textContent = `Error checking status: ${error.message}`;
                        progressStatus.style.color = '#f44336';
                    }
                    clearInterval(checkProgressInterval);
                }
            }, 3000); // Check every 3 seconds
        } catch (error) {
            console.error('Error starting audio processing:', error);
            const progressStatus = document.getElementById('podcast-progress-status');
            if (progressStatus) {
                progressStatus.textContent = `Error starting audio processing: ${error.message}`;
                progressStatus.style.color = '#f44336';
            }
        }
    })();
}
