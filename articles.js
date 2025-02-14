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
                const generatedTitle = await generateTitle(article.text, storage.openaiKey);
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

        // Check if the audio field is non-empty
        if (article.audio) {
            // Create Play Audio button
            const playBtn = document.createElement('button');
            playBtn.className = 'play-btn';
            playBtn.textContent = 'Play Audio';
            mainContent.appendChild(playBtn);

            // Create Play/Pause button (initially hidden)
            const playPauseBtn = document.createElement('button');
            playPauseBtn.className = 'play-pause-btn';
            playPauseBtn.textContent = '▶️'; // Play symbol
            playPauseBtn.style.display = 'none'; // Initially hidden
            mainContent.appendChild(playPauseBtn);

            let audio; // Variable to hold the audio instance

            // Add click handler for the Play button
            playBtn.addEventListener('click', async () => {
                try {
                    const audioBlob = await getAudioFile(article.audio); // Function to retrieve audio from IndexedDB
                    console.log("Retrieved audioBlob:", audioBlob); // Log the audioBlob for debugging

                    if (!audioBlob) {
                        throw new Error("Audio blob is undefined or null.");
                    }

                    const audioUrl = URL.createObjectURL(audioBlob); // Create a URL for the audio file
                    audio = new Audio(audioUrl);

                    // Show the Play/Pause button
                    playPauseBtn.style.display = 'inline';

                    // Add click handler for the Play/Pause button
                    playPauseBtn.addEventListener('click', () => {
                        if (audio.paused) {
                            audio.play();
                            playPauseBtn.textContent = '⏸️'; // Pause symbol
                        } else {
                            audio.pause();
                            playPauseBtn.textContent = '▶️'; // Play symbol
                        }
                    });

                    // Reset button text when audio ends
                    audio.addEventListener('ended', () => {
                        playPauseBtn.textContent = '▶️'; // Reset to Play symbol when audio ends
                        playPauseBtn.style.display = 'none'; // Hide the button when audio ends
                    });

                    audio.play(); // Start playing audio immediately
                } catch (error) {
                    console.error('Error playing audio:', error);
                    alert('Failed to play audio. Please try again.');
                }
            });
        } else {
            // Create Generate Audio button
            const generateAudioBtn = document.createElement('button');
            generateAudioBtn.className = 'generate-audio-btn';
            generateAudioBtn.textContent = 'Generate Audio';
            mainContent.appendChild(generateAudioBtn);

            // Add click handler for the Generate Audio button
            generateAudioBtn.addEventListener('click', async () => {
                const audioBlob = await generateAudio(article.summary, defaultVoice, index);
                const audioUrl = URL.createObjectURL(audioBlob); // Create URL from blob

                // Remove the Generate Audio button and replace with Play button
                generateAudioBtn.remove();

                // Create Play button
                const playBtn = document.createElement('button');
                playBtn.className = 'play-btn';
                playBtn.textContent = 'Play Audio';
                mainContent.appendChild(playBtn);

                // Add click handler for the Play button
                playBtn.addEventListener('click', () => {
                    const audio = new Audio(audioUrl);
                    audio.play();
                });

                // Save audio to IndexedDB and update article's audio field
                const audioId = `audio-${Date.now()}`; // Unique ID for the audio
                await saveAudioFile(audioId, audioBlob); // Save audio file in IndexedDB

                // Update local storage with audio reference
                const storage = await chrome.storage.local.get(['articles']);
                const articles = storage.articles || [];
                articles[index].audio = audioId; // Store the audio ID in the article
                await chrome.storage.local.set({ articles }); // Update storage
            });
        }

        // Add click handler for the Generate/Re-generate Summary button
        const generateSummaryBtn = mainContent.querySelector('.generate-summary-btn');
        generateSummaryBtn.addEventListener('click', async () => {
            try {
                const summary = await generateSummary(article.text);
                const summaryElement = mainContent.querySelector(`.article-summary#summary-${index}`);
                summaryElement.innerHTML = `<strong>Summary:</strong> ${summary}`;

                // Update the summary in the storage
                storage.articles[index].summary = summary; // Update summary in the array
                await chrome.storage.local.set({ articles: storage.articles }); // Save updated articles
            } catch (error) {
                console.error('Error generating summary:', error);
                alert('Failed to generate summary. Please try again.');
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
        const startDate = new Date(document.getElementById('startDate').value);
        const endDate = new Date(document.getElementById('endDate').value);
        const selectedArticles = document.querySelectorAll('.article-checkbox:checked');

        // Filter selected articles based on date range
        const filteredArticles = Array.from(selectedArticles).filter(checkbox => {
            const articleDiv = checkbox.closest('.article');
            const articleDate = new Date(articleDiv.querySelector('.article-date').textContent.replace('Saved on ', ''));
            return articleDate >= startDate && articleDate <= endDate;
        });

        if (filteredArticles.length === 0) {
            alert('Please select at least one article within the specified date range to generate a podcast.');
            return;
        }

        // Show loading icon
        const loadingIcon = document.getElementById('loadingIcon');
        if (loadingIcon) {
            loadingIcon.style.display = 'inline';
        }

        try {
            const articles = filteredArticles.map(checkbox => {
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

            // Save the podcast in IndexedDB with metadata
            await saveAudioFile(podcastId, finalAudio); // Save the podcast audio
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
    const apiKey = await getOpenAIKey(); // Retrieve the API key

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
                    content: 'Summarize the following article concisely while maintaining key details, \
                    covering the main topic, essential facts, important arguments, and any conclusions. \
                    Highlight the who, what, when, where, why, and how (if applicable). Retain the \
                    original tone—whether informative, analytical, or opinion-based—and include any \
                    significant statistics, quotes, or expert opinions mentioned. Ensure clarity, \
                    coherence, and neutrality (unless it is an opinion piece, in which case, reflect \
                    the stance of the author accurately). If there are action points or takeaways, include \
                    them in bullet points.'
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            max_tokens: 500
        })
    });

    if (!response.ok) {
        throw new Error('Failed to generate summary');
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
}

async function generateAudio(text, voice = "alloy") {
    const apiKey = await getOpenAIKey(); // Retrieve the OpenAI API key

    console.log("Using API Key:", apiKey);
    console.log("Text to convert:", text);
    console.log("Voice selected:", voice);

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "tts-1",
            input: text,
            voice: voice
        })
    });

    console.log("Response Status:", response.status);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`❌ Error generating audio: ${errorText}`);
    }

    const audioBlob = await response.blob();
    console.log("✅ Audio generated successfully!");

    return audioBlob; // Return the audio blob for further processing
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

async function generateConversationScript(articles) {
    const apiKey = await getOpenAIKey();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "gpt-4",
            messages: [{
                role: "system",
                content: `Create a concise 3-4 minute conversation between two hosts discussing these articles. 
                Key requirements:
                - Keep each speaker's line under 20 words
                - Maximum 6-8 exchanges total
                - Focus only on the most important points
                - Make it engaging but brief
                - Use natural, conversational language
                
                Format:
                Host1: [Speaker 1's brief dialogue]
                Host2: [Speaker 2's brief dialogue]
                
                Ensure each line starts with either "Host1:" or "Host2:"`
            }, {
                role: "user",
                content: JSON.stringify(articles)
            }],
            temperature: 0.7, // Add some variety but keep it focused
            max_tokens: 500  // Limit the response length
        })
    });

    const data = await response.json();
    return parseConversationScript(data.choices[0].message.content);
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

async function getOpenAIKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['openaiKey'], (result) => {
            if (result.openaiKey) {
                resolve(result.openaiKey);
            } else {
                reject(new Error('API key not found'));
            }
        });
    });
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
