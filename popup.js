// popup.js
import { saveArticle } from './db.js';
import { generateSummary, generateTitle } from './openai.js';
import { getSetting } from './db.js';

/**
 * Show status messages
 * @param {string} message - Message to display
 * @param {string} type - Type of message (success, error, etc.)
 */
function showStatus(message, type) {
    const statusMessage = document.getElementById("statusMessage");
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 3000);
}

/**
 * Verify content script is working
 * @param {number} tabId - Tab ID to check
 * @returns {Promise<boolean>} Whether content script is responsive
 */
async function verifyContentScript(tabId) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: "PING" });
        console.log("Content script ping response:", response);
        return response && response.status === "PONG";
    } catch (error) {
        console.warn("Content script ping failed:", error);
        return false;
    }
}

/**
 * Extract article content with multiple fallback strategies
 * @param {number} tabId - Tab ID to extract from
 * @returns {Promise<Object>} The extracted article data
 */
async function extractArticleWithFallbacks(tabId) {
    console.log("Starting article extraction with fallbacks for tab", tabId);
    
    // Try the normal extraction first
    try {
        const extractPromise = chrome.tabs.sendMessage(tabId, { action: "EXTRACT_ARTICLE" });
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Article extraction timed out")), 15000)
        );
        
        const articleData = await Promise.race([extractPromise, timeoutPromise]);
        
        if (articleData && articleData.text && articleData.text.length >= 100) {
            console.log("Successfully extracted article with normal method");
            return articleData;
        }
        
        throw new Error(articleData?.error || "Extracted content too short or empty");
    } catch (error) {
        console.warn("Primary extraction failed:", error);
        
        // Try fallback: using background script extraction
        console.log("Trying fallback extraction via background script...");
        try {
            const response = await chrome.runtime.sendMessage({
                action: "EXTRACT_ARTICLE_FALLBACK",
                tabId: tabId
            });
            
            if (response && response.text && response.text.length >= 100) {
                console.log("Successfully extracted article with fallback method");
                return response;
            }
            
            throw new Error("Fallback extraction failed to get substantial content");
        } catch (fallbackError) {
            console.error("Fallback extraction also failed:", fallbackError);
            throw new Error("Failed to extract article content after multiple attempts");
        }
    }
}

// Initialize the extension
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Extension popup opened, initializing...');
    
    const saveArticleBtn = document.getElementById('saveArticleBtn');
    const showArticlesBtn = document.getElementById('showArticlesBtn');
    const optionsLink = document.getElementById('optionsLink');
    
    console.log('Buttons found:', {
        saveArticleBtn: !!saveArticleBtn,
        showArticlesBtn: !!showArticlesBtn,
        optionsLink: !!optionsLink
    });

    // Load voice settings if they exist
    await loadVoiceSettings();

    if (saveArticleBtn) {
        saveArticleBtn.addEventListener('click', async () => {
            console.log('Save Article button clicked');
            try {
                console.log("Save button clicked");
                saveArticleBtn.disabled = true;
                saveArticleBtn.innerHTML = '<span class="icon">⏳</span>Saving...';
                
                // Get current tab
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab) {
                    showStatus("No active tab found", "error");
                    return;
                }
                console.log("Current tab:", tab.id, tab.url);
                
                // Check if we're on a valid page
                const invalidSites = [
                    'chrome://', 'chrome-extension://', 'about:', 'file:',
                    'chrome.google.com', 'addons.mozilla.org'
                ];
                
                if (invalidSites.some(site => tab.url.startsWith(site))) {
                    showStatus(`Cannot extract from ${tab.url}. Please try with a regular web page.`, "error");
                    return;
                }

                // Ensure content script is injected
                showStatus("Preparing extraction...", "info");
                
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['contentScript.js']
                    });
                    console.log("Content script injected successfully");
                    
                    // Give the content script a moment to initialize
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Verify content script is responsive
                    const isScriptResponsive = await verifyContentScript(tab.id);
                    if (!isScriptResponsive) {
                        console.warn("Content script not responding to ping test");
                        // Continue anyway, extraction will try fallbacks
                    }
                } catch (err) {
                    console.error("Content script injection failed:", err);
                    if (err.message.includes("Cannot access contents of the page")) {
                        showStatus("Cannot access page content. Try with a regular web page.", "error");
                        return;
                    }
                }

                // Show status to user
                showStatus("Extracting article content...", "info");

                // Extract article using our robust extraction function
                let articleData;
                try {
                    articleData = await extractArticleWithFallbacks(tab.id);
                } catch (extractError) {
                    console.error("All extraction attempts failed:", extractError);
                    showStatus("Failed to extract article. Please try a different page.", "error");
                    return;
                }

                console.log("Extracted article data:", {
                    title: articleData?.title,
                    textLength: articleData?.text?.length || 0
                });

                if (!articleData || !articleData.text || articleData.text.length < 100) {
                    showStatus("No article text found or text too short. Try with a longer article.", "error");
                    return;
                }

                // Add URL to the article data
                articleData.url = tab.url;
                
                // Show status to user
                showStatus("Saving article...", "info");

                // Save the article
                const response = await chrome.runtime.sendMessage({
                    action: "SAVE_ARTICLE",
                    payload: articleData
                });

                console.log("Response from background script:", response);

                if (response?.success) {
                    showStatus("Article saved successfully!", "success");
                } else {
                    console.error("Error details:", response);
                    showStatus("Failed to save the article: " + (response?.error || "Unknown error"), "error");
                }
            } catch (error) {
                console.error("Error in save article flow:", error);
                showStatus(error.message || "Failed to process the article.", "error");
            } finally {
                saveArticleBtn.disabled = false;
                saveArticleBtn.innerHTML = '<span class="icon">📝</span>Save This Article';
            }
        });
    }

    if (showArticlesBtn) {
        showArticlesBtn.addEventListener('click', async () => {
            console.log('Show Articles button clicked');
            const articlesPageUrl = chrome.runtime.getURL('articles.html');
            await chrome.tabs.create({ url: articlesPageUrl });
            window.close();
        });
    }

    if (optionsLink) {
        optionsLink.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options.html'));
            }
        });
    }
});

/**
 * Load voice settings from storage
 * This ensures the popup reflects the same voice settings used in the "Generate Podcast" popup
 */
async function loadVoiceSettings() {
    try {
        // Load host voice setting
        const hostVoice = await getSetting('host_voice') || 'echo'; // Default to 'echo' if not set
        const hostVoiceElement = document.getElementById('hostVoiceDisplay');
        if (hostVoiceElement) {
            // Map the voice ID to the display name that appears in the Generate Podcast popup
            const voiceNameMap = {
                'alloy': 'Esha',
                'echo': 'Hari',
                'fable': 'Mira',
                'onyx': 'Tej',
                'nova': 'Leela',
                'shimmer': 'Veena'
            };
            hostVoiceElement.textContent = voiceNameMap[hostVoice] || hostVoice;
        }
        
        // Load co-host voice setting
        const cohostVoice = await getSetting('cohost_voice') || 'nova'; // Default to 'nova' if not set
        const cohostVoiceElement = document.getElementById('cohostVoiceDisplay');
        if (cohostVoiceElement) {
            // Map the voice ID to the display name
            const voiceNameMap = {
                'alloy': 'Esha',
                'echo': 'Hari',
                'fable': 'Mira',
                'onyx': 'Tej',
                'nova': 'Leela',
                'shimmer': 'Veena'
            };
            cohostVoiceElement.textContent = voiceNameMap[cohostVoice] || cohostVoice;
        }
    } catch (error) {
        console.error('Error loading voice settings:', error);
    }
}
