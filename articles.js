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
        generatePodcastBtn.textContent = 'Generating...';
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

            // Check if a podcast already exists for these articles
            const articleIds = articles.map(a => a.id);
            console.log('Checking for existing podcast for articles:', articleIds);

            const { data: existingPodcasts, error: podcastError } = await supabase
                .from('article_audio')
                .select(`
                    audio_id,
                    audio_files (
                        file_url
                    )
                `)
                .in('article_id', articleIds);

            if (podcastError) {
                throw new Error(`Failed to check existing podcasts: ${podcastError.message}`);
            }

            // Group podcasts by audio_id to find if all articles share the same podcast
            const podcastGroups = {};
            existingPodcasts.forEach(entry => {
                if (!podcastGroups[entry.audio_id]) {
                    podcastGroups[entry.audio_id] = {
                        count: 0,
                        file_url: entry.audio_files?.file_url
                    };
                }
                podcastGroups[entry.audio_id].count++;
            });

            // Find if there's a podcast that contains all selected articles
            const existingPodcast = Object.entries(podcastGroups)
                .find(([_, group]) => group.count === articleIds.length);

            if (existingPodcast) {
                console.log('Found existing podcast:', existingPodcast);
                const [_, podcastData] = existingPodcast;

                // Get the signed URL for the audio file
                const audioUrlPath = new URL(podcastData.file_url).pathname;
                const fileName = audioUrlPath.split('/').pop();
                
                const { data: signedUrlData, error: signedUrlError } = await supabase
                    .storage
                    .from('audio-files')
                    .createSignedUrl(`public/${fileName}`, 604800);

                if (signedUrlError) {
                    console.error('Failed to get signed URL:', signedUrlError);
                    throw new Error(`Failed to get signed URL: ${signedUrlError.message}`);
                }

                const audioUrl = signedUrlData.signedUrl;
                console.log('Got signed URL for existing audio:', audioUrl);

                // Update the audio player with the existing podcast
                let bottomAudioContainer = document.getElementById('bottom-audio-player');
                if (!bottomAudioContainer) {
                    bottomAudioContainer = document.createElement('div');
                    bottomAudioContainer.id = 'bottom-audio-player';
                    bottomAudioContainer.className = 'fixed-bottom-player';
                    document.body.appendChild(bottomAudioContainer);
                }

                bottomAudioContainer.innerHTML = `
                    <div class="audio-player-wrapper">
                        <div class="podcast-info">
                            <h3>Existing Podcast</h3>
                            <p>Articles: ${articles.map(a => a.title).join(', ')}</p>
                        </div>
                        <audio 
                            class="podcast-audio" 
                            controls 
                            src="${audioUrl}"
                            preload="metadata"
                        >
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                `;

                alert('Loading existing podcast for selected articles.');
                return;
            }

            // If no existing podcast found, generate a new one
            console.log('No existing podcast found, generating new one...');
            const { data: podcastData, error: generationError } = await supabase.functions.invoke('generate-podcast', {
                body: { articles }
            });

            if (generationError) {
                throw new Error(`Failed to generate podcast: ${generationError.message}`);
            }

            console.log('Podcast generated successfully:', podcastData);

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

            // Create or get the bottom audio player container
            let bottomAudioContainer = document.getElementById('bottom-audio-player');
            if (!bottomAudioContainer) {
                bottomAudioContainer = document.createElement('div');
                bottomAudioContainer.id = 'bottom-audio-player';
                bottomAudioContainer.className = 'fixed-bottom-player';
                document.body.appendChild(bottomAudioContainer);
            }

            // Update the audio player with the new podcast
            bottomAudioContainer.innerHTML = `
                <div class="audio-player-wrapper">
                    <div class="podcast-info">
                        <h3>Generated Podcast</h3>
                        <p>Articles: ${articles.map(a => a.title).join(', ')}</p>
                    </div>
                    <audio 
                        class="podcast-audio" 
                        controls 
                        src="${audioUrl}"
                        preload="metadata"
                    >
                        Your browser does not support the audio element.
                    </audio>
                </div>
            `;

            // Show success message
            alert('Podcast generated successfully!');

        } catch (error) {
            console.error('Error generating podcast:', error);
            alert('Failed to generate podcast. Please try again.');
        } finally {
            // Reset button state
            generatePodcastBtn.disabled = false;
            generatePodcastBtn.textContent = 'Generate Podcast';
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
    if (!currentSession?.user?.id) {
        console.error('No authenticated user found');
        alert('Please sign in to view your podcasts');
        return;
    }

    podcastList.innerHTML = `
        <tr>
            <th style="width: 80px">Play</th>
            <th>Articles</th>
        </tr>
    `;

    try {
        console.log('Fetching podcasts for user:', currentSession.user.id);
        
        // First get all article_audio entries for the user
        const { data: audioFiles, error: audioError } = await supabase
            .from('article_audio')
            .select(`
                audio_id,
                article_id,
                audio_files (
                    id,
                    file_url,
                    created_at
                ),
                articles (
                    id,
                    title
                )
            `)
            .eq('user_id', currentSession.user.id)
            .order('created_at', { ascending: false });

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
            if (entry.articles) {
                groups[entry.audio_id].articles.push(entry.articles);
            }
            return groups;
        }, {});

        console.log('Grouped podcasts:', podcastGroups);

        // Keep track of currently playing audio
        let currentlyPlaying = null;

        // Create table rows for each podcast
        Object.values(podcastGroups).forEach(podcast => {
            if (!podcast.file_url) return; // Skip if no audio URL

            const row = document.createElement('tr');
            
            // Create play button cell
            const playCell = document.createElement('td');
            const playBtn = document.createElement('button');
            playBtn.className = 'podcast-play-btn';
            playBtn.innerHTML = '▶️';
            playBtn.dataset.playing = 'false';

            // Create audio element
            const audio = new Audio(podcast.file_url);
            
            // Handle play/pause
            playBtn.addEventListener('click', () => {
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
            
            podcast.articles.forEach(article => {
                const li = document.createElement('li');
                li.textContent = article.title;
                articlesList.appendChild(li);
            });
            
            articlesCell.appendChild(articlesList);
            row.appendChild(articlesCell);

            podcastList.appendChild(row);
        });

        if (podcastList.children.length <= 1) { // Only header row
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
        const checkboxes = document.querySelectorAll('.article-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
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
}
