import supabase from './supabaseClient';

let currentSession = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Articles page: Initializing...');
    await initializeSession();
    
    if (currentSession) {
        await loadArticles();
    } else {
        console.log('No active session found, cannot load articles.');
    }
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
        
        displayArticles(mappedArticles);
    } catch (error) {
        console.error('Articles page: Error in loadArticles:', error);
        console.error('Error stack:', error.stack);
        const container = document.getElementById('articles-container');
        container.innerHTML = '<div class="no-articles">Error loading articles. Please try again.</div>';
    }
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
            const articleDate = new Date(storage.articles[index].date); // Access the date from storage

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

    // Generate Podcast button handler
    document.getElementById('generatePodcast').addEventListener('click', async () => {
        const selectedArticles = document.querySelectorAll('.article-checkbox:checked');

        // Check if at least one article is selected
        if (selectedArticles.length === 0) {
            alert('Please select at least one article to generate a podcast.');
            return;
        }

        // Show loading icon
        const loadingIcon = document.getElementById('loadingIcon');
        if (loadingIcon) {
            loadingIcon.style.display = 'inline';
        }

        try {
            const articles = Array.from(selectedArticles).map(checkbox => {
                const articleDiv = checkbox.closest('.article');
                return {
                    title: articleDiv.querySelector('.article-title').textContent,
                    content: articleDiv.querySelector('.article-content').textContent,
                    summary: articleDiv.querySelector('.article-summary')?.textContent // Assuming you have a summary element
                };
            });

            const articleTitles = articles.map(article => article.title).sort().join(', '); // Sort titles for consistency
            console.log('Selected articles:', articleTitles); // Log the titles of the selected articles

            // Create a unique podcast ID based on the article titles
            const podcastId = `podcast-${btoa(encodeURIComponent(articleTitles))}`; // Encode the titles for a unique ID

            // Check if the podcast already exists in IndexedDB
            const existingPodcast = await getAudioFile(podcastId);
            if (existingPodcast) {
                console.log(`Podcast already exists with ID: ${podcastId}`);
                alert(`Playing existing podcast for: ${articleTitles}`);
                const podcastAudio = new Audio(URL.createObjectURL(existingPodcast));
                podcastAudio.play();
                return; // Exit if podcast already exists
            }

            // Prepare articles data for conversation script
            const conversationData = articles.map(article => ({
                text: article.content,
                summary: article.summary || '', // Use existing summary or an empty string if it doesn't exist
                title: article.title
            }));

            const conversationScript = await generateConversationScript(conversationData);
            
            // Log metadata for the selected articles
            console.log(`Generating podcast for: ${articleTitles}`);
            alert(`Generating podcast for: ${articleTitles}`); // Frontend log

            // Generate audio for both speakers
            const speaker1Audio = await generateSpeechAudio(conversationScript.speaker1Lines, 'alloy');
            const speaker2Audio = await generateSpeechAudio(conversationScript.speaker2Lines, 'onyx');
            
            // Pass the original script to combineAudioTracks
            const finalAudio = await combineAudioTracks(speaker1Audio, speaker2Audio, conversationScript);

            // Save the podcast in IndexedDB with metadata and titles
            await savePodcastWithTitles(podcastId, finalAudio, articles); // Save the podcast audio with titles
            console.log(`Podcast saved with ID: ${podcastId}`); // Log the podcast ID

            // Create play/pause button for the podcast
            const playPauseBtn = document.createElement('button');
            playPauseBtn.className = 'play-pause-podcast-btn';
            playPauseBtn.textContent = '▶️'; // Play symbol

            // Create podcast container if it doesn't exist
            let podcastContainer = document.getElementById('podcast-container');
            if (!podcastContainer) {
                podcastContainer = document.createElement('div');
                podcastContainer.id = 'podcast-container'; // Set the ID for the new container
                document.body.appendChild(podcastContainer); // Append it to the body or a specific parent element
            }

            podcastContainer.appendChild(playPauseBtn); // Append to the podcast container

            // Add click handler for the play/pause button
            let podcastAudio = new Audio(URL.createObjectURL(finalAudio));
            playPauseBtn.addEventListener('click', () => {
                if (podcastAudio.paused) {
                    podcastAudio.play();
                    playPauseBtn.textContent = '⏸️'; // Pause symbol
                } else {
                    podcastAudio.pause();
                    playPauseBtn.textContent = '▶️'; // Play symbol
                }
            });

        } catch (error) {
            console.error('Error generating podcast:', error);
            alert('Failed to generate podcast. Please try again.');
        } finally {
            // Hide loading icon
            if (loadingIcon) {
                loadingIcon.style.display = 'none';
            }
        }
    });

    // Add event listeners for date range inputs
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    const filterArticlesByDate = () => {
        const startDate = new Date(startDateInput.value);
        const endDate = new Date(endDateInput.value);
        const articles = document.querySelectorAll('.article');

        // Check if both date inputs are empty
        if (!startDateInput.value && !endDateInput.value) {
            articles.forEach(article => {
                article.style.display = ''; // Show all articles
            });
            return; // Exit the function early
        }

        articles.forEach((article, index) => {
            // Access the date from the storage.articles array
            const articleDate = new Date(storage.articles[index].date); // Assuming storage.articles is accessible

            // Check if the article date is within the selected range
            if (articleDate >= startDate && articleDate <= endDate) {
                article.style.display = ''; // Show article
            } else {
                article.style.display = 'none'; // Hide article
            }
        });
    };

    // Attach event listeners to filter articles when dates change
    startDateInput.addEventListener('change', filterArticlesByDate);
    endDateInput.addEventListener('change', filterArticlesByDate);

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

    // Uncheck Select All if any article is unchecked
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    selectAllCheckbox.checked = Array.from(document.querySelectorAll('.select-article')).every(cb => cb.checked);
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
    podcastList.innerHTML = ''; // Clear existing entries

    // Retrieve all podcasts from IndexedDB
    const podcasts = await getAllPodcasts(); // Fetch podcasts

    podcasts.forEach(podcast => {
        const row = document.createElement('tr');

        // Create a variable to hold the audio instance
        let podcastAudio = new Audio(URL.createObjectURL(podcast.audioBlob));

        // Create play/pause button for each podcast
        const playPauseBtn = document.createElement('button');
        playPauseBtn.textContent = '▶️'; // Play symbol

        // Add click event listener for play/pause button
        playPauseBtn.addEventListener('click', () => {
            if (podcastAudio.paused) {
                podcastAudio.play();
                playPauseBtn.textContent = '⏸️'; // Change to pause symbol
            } else {
                podcastAudio.pause();
                playPauseBtn.textContent = '▶️'; // Change to play symbol
            }
        });

        // Create cell for the play/pause button
        const podcastCell = document.createElement('td');
        podcastCell.appendChild(playPauseBtn);
        row.appendChild(podcastCell);

        // Create delete button (bin symbol)
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️'; // Bin symbol
        deleteBtn.addEventListener('click', async () => {
            // Delete podcast from IndexedDB
            const db = await openDb();
            const tx = db.transaction("audioFiles", "readwrite");
            const store = tx.objectStore("audioFiles");
            await store.delete(podcast.id); // Delete the podcast by ID
            await tx.complete;

            // Remove the row from the table
            podcastList.removeChild(row);
        });

        // Create cell for the delete button
        const deleteCell = document.createElement('td');
        deleteCell.appendChild(deleteBtn);
        row.appendChild(deleteCell);

        // Create cell for the article titles
        const titlesCell = document.createElement('td');
        // Check if titles is defined and is an array
        if (Array.isArray(podcast.titles)) {
            titlesCell.textContent = podcast.titles.join(', '); // Join titles if it's an array
        } else {
            titlesCell.textContent = 'No titles available'; // Fallback message
        }
        row.appendChild(titlesCell);

        podcastList.appendChild(row);
    });
}

// Function to get all podcasts from IndexedDB
async function getAllPodcasts() {
    const db = await openDb();
    const tx = db.transaction("audioFiles", "readonly");
    const store = tx.objectStore("audioFiles");

    return new Promise((resolve, reject) => {
        const allPodcastsRequest = store.getAll(); // Get all podcasts

        allPodcastsRequest.onsuccess = (event) => {
            const allPodcasts = event.target.result; // Access the result from the event
            // Check if allPodcasts is an array
            if (!Array.isArray(allPodcasts)) {
                console.error('Expected an array but got:', allPodcasts);
                resolve([]); // Return an empty array if the data is not as expected
            } else {
                resolve(allPodcasts.map(podcast => ({
                    id: podcast.id,
                    audioBlob: podcast.audioBlob,
                    titles: podcast.titles // Assuming titles are stored in the podcast object
                })));
            }
        };

        allPodcastsRequest.onerror = (event) => {
            console.error('Failed to retrieve podcasts:', event.target.error);
            reject(new Error('Failed to retrieve podcasts from IndexedDB.'));
        };
    });
}

// Function to save podcast audio and titles in IndexedDB
async function savePodcastWithTitles(id, audioBlob, articles) {
    const titles = articles.map(article => article.title); // Extract titles from articles
    await saveAudioFile(id, audioBlob); // Save the audio file
    const db = await openDb();
    const tx = db.transaction("audioFiles", "readwrite");
    const store = tx.objectStore("audioFiles");

    // Save the titles along with the audio blob
    await store.put({ id, audioBlob, titles }); // Ensure the structure is correct
    return tx.complete;
}

// Function to display articles
function displayArticles(articles) {
    console.log('Articles page: Displaying articles:', articles);
    const container = document.getElementById('articles-container');
    container.innerHTML = ''; // Clear existing content

    if (!articles || articles.length === 0) {
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
                    textLength: article.content?.length || 0,
                    hasContent: !!article.content,
                    articleData: article
                });

                if (!article.content) {
                    throw new Error('No article text found to generate summary');
                }

                // Show loading state
                generateSummaryBtn.disabled = true;
                generateSummaryBtn.textContent = 'Generating...';
                
                const summary = await generateSummary(article.content);
                console.log('Summary generated successfully:', {
                    summaryLength: summary.length,
                    summary: summary.substring(0, 100) + '...' // Log first 100 chars
                });

                const summaryElement = mainContent.querySelector(`.article-summary#summary-${index}`);
                summaryElement.style.display = 'block';
                summaryElement.innerHTML = `<strong>Summary:</strong> ${summary}`;
                
                // Update the summary in storage
                article.summary = summary;
                
                // Update in Supabase
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

        // Add click handler for expand button
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

        articleElement.appendChild(mainContent);
        articleElement.appendChild(controls);
        container.appendChild(articleElement);
    });
}
