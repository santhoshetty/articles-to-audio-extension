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

    // Set up date filtering
    setupDateFiltering();

    // Add Generate Podcast button handler
    const generatePodcastBtn = document.getElementById('generatePodcast');
    console.log('Generate Podcast button:', generatePodcastBtn);
    
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

    // Add CSS for the delete button and deleting state
    const style = document.createElement('style');
    style.textContent = `
        .delete-podcast-btn {
            background-color: #ff4d4d;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.3s;
        }
        
        .delete-podcast-btn:hover {
            background-color: #ff0000;
        }
        
        tr.deleting {
            opacity: 0.5;
            background-color: #ffeeee;
            transition: all 0.3s;
        }
        
        .podcast-table th, .podcast-table td {
            padding: 10px;
            border-bottom: 1px solid #ddd;
        }
    `;
    document.head.appendChild(style);
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

            // Add delete button to the row
            addDeleteButtonToPodcastRow(row, podcast);

            podcastList.appendChild(row);
        }

        if (podcastList.children.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="3" style="text-align: center;">No podcasts found</td>';
            podcastList.appendChild(emptyRow);
        }

    } catch (error) {
        console.error('Error loading podcasts:', error);
        podcastList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: red;">Failed to load podcasts. Error: ${error.message}</td></tr>`;
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

// Function to check if the GCP migration feature flag is enabled
async function isGcpMigrationEnabled() {
    // Default to enabled for now - can be replaced with actual feature flag check once available
    return true;
    
    // Uncomment and use this when feature flag table is available
    /*
    const { data } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('name', 'gcp_podcast_migration')
        .single();
        
    return data?.enabled || false;
    */
}

// New approach - Enqueue podcast job and poll for status
async function startPodcastGeneration(articles) {
    try {
        // Only make a single request - no retry needed since the edge function
        // now responds immediately and doesn't wait for GCP processing
        const { data, error } = await supabase.functions.invoke('enqueue-podcast-job', {
            body: { articles }
        });
        
        if (error) throw error;
        
        console.log('Podcast generation job initiated:', data);
        return data.job_id;
    } catch (error) {
        console.error('Error starting podcast generation:', error);
        throw new Error(`Failed to start podcast generation: ${error.message}`);
    }
}

// Check podcast job status
async function checkPodcastStatus(jobId) {
    const { data, error } = await supabase.functions.invoke('check-podcast-status', {
        method: 'POST',
        body: { job_id: jobId }
    });
    
    if (error) throw error;
    return data;
}

// Poll for podcast status updates
async function pollPodcastStatus(jobId, onStatusUpdate, intervalMs = 5000) {
    // Initialize polling
    const poll = async () => {
        try {
            const status = await checkPodcastStatus(jobId);
            
            // Call the status update callback with the current status
            onStatusUpdate(status);
            
            // If job is still in progress, continue polling
            if (['pending', 'processing', 'script_generated'].includes(status.job?.status)) {
                setTimeout(poll, intervalMs);
            }
        } catch (error) {
            console.error('Error polling podcast status:', error);
            onStatusUpdate({ error: error.message });
        }
    };
    
    // Start polling
    poll();
}

// Function to update UI based on podcast status
function updatePodcastUI(statusData) {
    console.log('Updating podcast UI with status:', statusData);
    
    // Create or get the bottom audio player container
    let bottomAudioContainer = document.getElementById('bottom-audio-player');
    if (!bottomAudioContainer) {
        bottomAudioContainer = document.createElement('div');
        bottomAudioContainer.id = 'bottom-audio-player';
        bottomAudioContainer.className = 'fixed-bottom-player';
        document.body.appendChild(bottomAudioContainer);
    }

    // Handle error case
    if (statusData.error) {
        bottomAudioContainer.innerHTML = `
            <div class="audio-player-wrapper">
                <div class="status-indicator failed">
                    <h3>Error Generating Podcast</h3>
                    <p>${statusData.error}</p>
                </div>
            </div>
        `;
        return;
    }

    // Get job status and data - check both audio and audio_url properties
    const { job, audio, audio_url } = statusData;
    
    // Determine which audio URL to use
    const finalAudioUrl = audio_url || (audio && audio.url);
    
    // If job is complete and we have an audio URL
    if (job && job.status === 'completed' && finalAudioUrl) {
        bottomAudioContainer.innerHTML = `
            <div class="audio-player-wrapper">
                <div class="status-indicator completed">
                    <h3>Your Podcast is Ready!</h3>
                </div>
                <div class="podcast-info">
                    <p>Generated on ${new Date(job.processing_completed_at).toLocaleString()}</p>
                </div>
                <audio controls class="podcast-audio" src="${finalAudioUrl}">
                    Your browser does not support the audio element.
                </audio>
            </div>
        `;
    } else if (job) {
        // Show in-progress status
        bottomAudioContainer.innerHTML = `
            <div class="audio-player-wrapper">
                <div class="status-indicator ${job.status || 'pending'}">
                    <h3>Podcast Status: ${job.status || 'Pending'}</h3>
                    <p>Created: ${new Date(job.created_at).toLocaleString()}</p>
                    ${job.processing_started_at ? `<p>Processing started: ${new Date(job.processing_started_at).toLocaleString()}</p>` : ''}
                </div>
                ${statusData.logs && statusData.logs.length > 0 ? `
                <div class="progress-logs">
                    <h4>Progress:</h4>
                    <ul>
                        ${statusData.logs.map(log => `<li>${new Date(log.timestamp).toLocaleTimeString()}: ${log.message}</li>`).join('')}
                    </ul>
                </div>` : ''}
            </div>
        `;
    } else {
        // Handle case where job data is missing or invalid
        bottomAudioContainer.innerHTML = `
            <div class="audio-player-wrapper">
                <div class="status-indicator failed">
                    <h3>Error Generating Podcast</h3>
                    <p>Invalid job status data returned from server</p>
                </div>
            </div>
        `;
    }
}

// Update the existing podcast generation logic to use the new approach
document.getElementById('generatePodcast').addEventListener('click', async () => {
    // Define all variables at the beginning
    let selectedCheckboxes, selectedArticleIds, articles = [], bottomAudioContainer;
    
    try {
        selectedCheckboxes = document.querySelectorAll('.article-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one article to generate a podcast.');
            return;
        }

        // Get selected article IDs
        selectedArticleIds = Array.from(selectedCheckboxes).map(checkbox => checkbox.dataset.articleId);
        
        // Show loading state
        document.getElementById('loadingIcon').style.display = 'inline-block';
        document.getElementById('generatePodcast').disabled = true;
        
        // Get the articles data
        for (const articleId of selectedArticleIds) {
            const { data, error } = await supabase
                .from('articles')
                .select('*')
                .eq('id', articleId)
                .single();

            if (error) {
                console.error('Error fetching article:', error);
                continue;
            }

            articles.push(data);
        }

        // Create or get the bottom audio player container - define this once at the beginning
        bottomAudioContainer = document.getElementById('bottom-audio-player');
        if (!bottomAudioContainer) {
            bottomAudioContainer = document.createElement('div');
            bottomAudioContainer.id = 'bottom-audio-player';
            bottomAudioContainer.className = 'fixed-bottom-player';
            document.body.appendChild(bottomAudioContainer);
        }

        // Check if GCP migration is enabled
        const useGcp = await isGcpMigrationEnabled();
        
        if (useGcp) {
            // Show initial loading state
            bottomAudioContainer.innerHTML = `
                <div class="audio-player-wrapper">
                    <div class="status-indicator pending">
                        <h3>Starting Podcast Generation...</h3>
                    </div>
                </div>
            `;
            
            // Start GCP-based podcast generation and get job ID
            const jobId = await startPodcastGeneration(articles);
            console.log('Podcast generation job started with ID:', jobId);
            
            // Update UI with initial job status
            bottomAudioContainer.innerHTML = `
                <div class="audio-player-wrapper">
                    <div class="status-indicator pending">
                        <h3>Podcast Generation Started</h3>
                        <p>Job ID: ${jobId}</p>
                        <p>Starting processing...</p>
                    </div>
                </div>
            `;
            
            // Start polling for status updates
            pollPodcastStatus(jobId, updatePodcastUI);
        } else {
            // Use legacy workflow
            console.log('No existing podcast found, generating new one...');
            const { data: podcastData, error: generationError } = await supabase.functions.invoke('generate-podcast', {
                body: { articles }
            });

            if (generationError) {
                throw new Error(`Failed to generate podcast: ${generationError.message}`);
            }

            console.log('Podcast generated successfully:', podcastData);

            // Clear the loading state wrapper
            bottomAudioContainer.innerHTML = '';

            // Extract the file path from the audio_url
            const audioUrlPath = new URL(podcastData.audio_url).pathname;
            const fileName = audioUrlPath.split('/').pop();
            
            // Get the signed URL for the audio file
            const { data: signedUrlData, error: signedUrlError } = await supabase
                .storage
                .from('audio-files')
                .createSignedUrl(`public/${fileName}`, 604800);

            if (signedUrlError) {
                console.error('Failed to get signed URL:', signedUrlError);
                throw new Error(`Failed to get signed URL: ${signedUrlError.message}`);
            }

            const audioUrl = signedUrlData.signedUrl;
            console.log('Got signed URL for audio:', audioUrl);

            // Update the audio player with the new podcast - use the already defined bottomAudioContainer
            bottomAudioContainer.innerHTML = `
                <div class="audio-player-wrapper">
                    <div class="podcast-info">
                        <h3>Your Podcast is Ready!</h3>
                    </div>
                    <audio controls class="podcast-audio" src="${audioUrl}">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error generating podcast:', error);
        alert(`Error generating podcast: ${error.message}`);
        
        // Show error in the audio player if it exists
        const bottomAudioContainer = document.getElementById('bottom-audio-player');
        if (bottomAudioContainer) {
            bottomAudioContainer.innerHTML = `
                <div class="audio-player-wrapper">
                    <div class="status-indicator failed">
                        <h3>Error Generating Podcast</h3>
                        <p>${error.message}</p>
                    </div>
                </div>
            `;
        }
    } finally {
        // Hide loading icon and re-enable button
        document.getElementById('loadingIcon').style.display = 'none';
        document.getElementById('generatePodcast').disabled = false;
    }
});

// Helper function to check if a file exists in storage
async function checkFileExists(bucket, path) {
    try {
        console.log(`Checking if file exists in bucket: ${bucket}, path: ${path}`);
        
        // Try to get file metadata, which will fail if file doesn't exist
        const { data, error } = await supabase
            .storage
            .from(bucket)
            .createSignedUrl(path, 10); // Short expiry just to check existence
            
        if (error && error.message.includes('Not Found')) {
            console.log('File does not exist in storage');
            return false;
        }
        
        // If we get here, file exists
        console.log('File exists in storage');
        return true;
    } catch (error) {
        console.error('Error checking file existence:', error);
        // Assume file doesn't exist on error
        return false;
    }
}

// Update the delete podcast function to check file existence
async function deletePodcast(audioId) {
    try {
        console.log('Starting complete podcast deletion for audioId:', audioId);
        
        // 1. Get the audio file information
        const { data: audioFile, error: audioError } = await supabase
            .from('audio_files')
            .select('file_url')
            .eq('id', audioId)
            .single();
            
        if (audioError) {
            console.error('Error fetching audio file info:', audioError);
            throw new Error(`Failed to fetch audio file info: ${audioError.message}`);
        }
        
        if (!audioFile) {
            console.error('Audio file not found in database');
            throw new Error('Audio file not found in database');
        }
        
        // 2. Delete the actual file from storage if it exists
        // Extract the filename from the file_url
        const storagePath = 'public/' + audioFile.file_url.split('/').pop();
        
        // Check if file exists before trying to delete
        const fileExists = await checkFileExists('audio-files', storagePath);
        
        if (fileExists) {
            console.log('Removing file from storage:', storagePath);
            const { error: storageError } = await supabase
                .storage
                .from('audio-files')
                .remove([storagePath]);
                
            if (storageError) {
                console.error('Error removing file from storage:', storageError);
                // Continue with deletion even if storage removal fails
            }
        } else {
            console.log('File not found in storage, skipping file deletion');
        }
        
        // 3. Delete related entries in article_audio table
        console.log('Removing article_audio entries for audioId:', audioId);
        const { error: articleAudioError } = await supabase
            .from('article_audio')
            .delete()
            .eq('audio_id', audioId);
            
        if (articleAudioError) {
            console.error('Error removing article_audio entries:', articleAudioError);
            throw new Error(`Failed to remove article_audio entries: ${articleAudioError.message}`);
        }
        
        // 4. Delete related entries in podcast_jobs table (if exists)
        try {
            console.log('Removing podcast_jobs entries for audioId:', audioId);
            const { error: jobsError } = await supabase
                .from('podcast_jobs')
                .delete()
                .eq('audio_id', audioId);
                
            if (jobsError) {
                console.error('Error removing podcast_jobs entries:', jobsError);
                // Continue with deletion even if jobs removal fails
            }
        } catch (podcastJobsError) {
            console.error('Error with podcast_jobs table, might not exist:', podcastJobsError);
            // Continue with deletion even if table doesn't exist
        }
        
        // 5. Check for GCP references and clean those up if enabled
        const useGcp = await isGcpMigrationEnabled();
        if (useGcp) {
            console.log('Cleaning up any GCP resources...');
            try {
                // Try a safer approach by checking if the function exists
                const { data: functions } = await supabase.functions.list();
                const hasCleanupFunction = functions.some(f => f.name === 'cleanup-gcp-resources');
                
                if (hasCleanupFunction) {
                    const { error: gcpCleanupError } = await supabase.functions.invoke('cleanup-gcp-resources', {
                        body: { audioId }
                    });
                    
                    if (gcpCleanupError) {
                        console.error('Error cleaning up GCP resources:', gcpCleanupError);
                    }
                } else {
                    console.log('GCP cleanup function not found, skipping');
                }
            } catch (gcpError) {
                console.error('Failed to clean up GCP resources:', gcpError);
                // Continue with deletion even if GCP cleanup fails
            }
        }
        
        // 6. Finally, delete the audio_files entry
        console.log('Removing audio_files entry:', audioId);
        const { error: audioFilesError } = await supabase
            .from('audio_files')
            .delete()
            .eq('id', audioId);
            
        if (audioFilesError) {
            console.error('Error removing audio_files entry:', audioFilesError);
            throw new Error(`Failed to remove audio_files entry: ${audioFilesError.message}`);
        }
        
        console.log('Podcast deletion completed successfully for audioId:', audioId);
        return true;
    } catch (error) {
        console.error('Error in deletePodcast function:', error);
        throw error;
    }
}

// Add delete button to podcasts table
function addDeleteButtonToPodcastRow(row, podcast) {
    const deleteCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete-podcast-btn';
    
    // Create a status indicator element
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'delete-status';
    statusIndicator.style.display = 'none';
    statusIndicator.style.fontSize = '12px';
    statusIndicator.style.marginTop = '5px';
    
    deleteBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        if (confirm('Are you sure you want to delete this podcast? This cannot be undone.')) {
            try {
                // Show deletion in progress
                row.classList.add('deleting');
                deleteBtn.disabled = true;
                deleteBtn.textContent = 'Deleting...';
                statusIndicator.style.display = 'block';
                statusIndicator.textContent = 'Deletion in progress...';
                statusIndicator.style.color = '#666';
                
                // Run the deletion process
                await deletePodcast(podcast.id);
                
                // Success handling
                statusIndicator.textContent = 'Successfully deleted!';
                statusIndicator.style.color = 'green';
                
                // Wait a moment to show success message before removing row
                setTimeout(() => {
                    row.remove(); // Remove row from table after successful deletion
                    
                    // Refresh the podcasts list
                    loadPodcasts(document.getElementById('podcast-list'));
                }, 1000);
                
                // Clear browser cache for this audio URL if possible
                if (podcast.file_url) {
                    try {
                        await clearAudioCaches(podcast.file_url);
                        console.log('Cleared cache for URL:', podcast.file_url);
                    } catch (cacheError) {
                        console.warn('Could not clear audio cache:', cacheError);
                    }
                }
            } catch (error) {
                console.error('Error during podcast deletion:', error);
                
                // Error handling with more details
                statusIndicator.textContent = `Error: ${error.message}`;
                statusIndicator.style.color = 'red';
                
                // Re-enable the button for retry
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Retry Delete';
                row.classList.remove('deleting');
                
                // Show error in console with full details
                console.error('Full error details:', error);
            }
        }
    });
    
    // Add elements to the cell
    deleteCell.appendChild(deleteBtn);
    deleteCell.appendChild(statusIndicator);
    row.appendChild(deleteCell);
}

// Utility function to clear browser caches for specific URL patterns
async function clearAudioCaches(urlPattern = null) {
    try {
        // Try to access the Cache API
        if ('caches' in window) {
            // Get all cache names
            const cacheNames = await caches.keys();
            
            for (const cacheName of cacheNames) {
                // Open each cache
                const cache = await caches.open(cacheName);
                const requests = await cache.keys();
                
                // Filter requests matching our pattern if one is provided
                const requestsToDelete = urlPattern 
                    ? requests.filter(req => req.url.includes(urlPattern))
                    : requests.filter(req => 
                        req.url.includes('audio-files') || 
                        req.url.includes('.mp3') || 
                        req.url.includes('.wav') ||
                        req.url.includes('/storage/v1/')
                    );
                
                // Delete matching requests
                for (const request of requestsToDelete) {
                    console.log('Clearing cached URL:', request.url);
                    await cache.delete(request);
                }
            }
            console.log('Audio caches cleared successfully');
            return true;
        } else {
            console.warn('Cache API not available in this browser');
            return false;
        }
    } catch (error) {
        console.error('Error clearing caches:', error);
        return false;
    }
}

// Add a clear cache button to the podcasts page
function addClearCacheButton() {
    const container = document.querySelector('.podcasts-container');
    if (!container) return;
    
    const clearCacheBtn = document.createElement('button');
    clearCacheBtn.textContent = 'Clear Audio Cache';
    clearCacheBtn.className = 'clear-cache-btn';
    clearCacheBtn.style.cssText = 'background-color: #4285f4; color: white; border: none; padding: 8px 16px; margin: 10px 0; border-radius: 4px; cursor: pointer;';
    
    clearCacheBtn.addEventListener('click', async () => {
        clearCacheBtn.disabled = true;
        clearCacheBtn.textContent = 'Clearing...';
        
        const cleared = await clearAudioCaches();
        
        if (cleared) {
            alert('Audio cache cleared successfully. Please reload the page to see changes.');
            window.location.reload();
        } else {
            alert('Failed to clear cache. Try manually clearing browser cache.');
            clearCacheBtn.disabled = false;
            clearCacheBtn.textContent = 'Clear Audio Cache';
        }
    });
    
    container.insertBefore(clearCacheBtn, container.firstChild);
}

// Call this function when loading the podcasts page
document.addEventListener('DOMContentLoaded', () => {
    const podcastsContainer = document.querySelector('.podcasts-container');
    if (podcastsContainer) {
        addClearCacheButton();
    }
});
