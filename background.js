// background.js

// Import local database operations
import { saveArticle } from './db.js';
import { generateSummary, generateTitle } from './openai.js';

// Extension initialization flag
let initialized = false;

// Initialize the extension when installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed or updated');
  initialize();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started, initializing extension');
  initialize();
});

// Handle content script ready messages
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === "CONTENT_SCRIPT_READY") {
    console.log("Content script ready in tab:", sender.tab?.id);
    return false;
  }
});

// Initialize the extension
async function initialize() {
  if (initialized) return;
  
  console.log('Initializing extension');
  
  try {
    // Register a handler for article extraction requests
    chrome.runtime.onMessage.addListener(handleMessages);
    
    initialized = true;
    console.log('Extension initialized successfully');
  } catch (error) {
    console.error('Error initializing extension:', error);
  }
}

// Handle messages from content scripts and popup
function handleMessages(request, sender, sendResponse) {
  console.log('Background received message:', request.action || request.type);
  
  if (request.action === "SAVE_ARTICLE") {
    handleSaveArticle(request.payload)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('Error saving article:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === "EXTRACT_ARTICLE") {
    handleExtractArticle(sender.tab)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('Error extracting article:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === "EXTRACT_ARTICLE_FALLBACK") {
    const tabId = request.tabId;
    // Get the tab info
    chrome.tabs.get(tabId)
      .then(tab => handleExtractArticleFallback(tab))
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('Error in fallback extraction:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
  
  // Default response for unhandled messages
  return false;
}

/**
 * Extract article content from the current tab
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<Object>} Extracted article data
 */
async function handleExtractArticle(tab) {
  if (!tab || !tab.id) {
    throw new Error('No active tab found');
  }
  
  try {
    console.log(`Attempting to extract article from tab ${tab.id} (${tab.url})`);
    
    // First, check if on a valid page
    const invalidSites = [
      'chrome://', 'chrome-extension://', 'about:', 'file:',
      'chrome.google.com', 'addons.mozilla.org'
    ];
    
    if (invalidSites.some(site => tab.url.startsWith(site))) {
      throw new Error(`Cannot extract from ${tab.url}. Please try with a regular web page.`);
    }
    
    // Attempt to inject the content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['contentScript.js']
      });
      console.log("Content script injection successful");
    } catch (err) {
      console.error("Content script injection error:", err);
      // If we can't inject, try to proceed anyway as the content script might already be there
      if (err.message.includes("Cannot access")) {
        throw new Error("Cannot access page content. Please try with a regular web page.");
      }
    }
    
    // Create a timeout promise
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Article extraction timed out")), 10000)
    );
    
    // Try to ping the content script first
    try {
      const pingPromise = chrome.tabs.sendMessage(tab.id, { action: "PING" });
      const pingResponse = await Promise.race([pingPromise, timeout])
        .catch(err => {
          console.warn("Content script ping failed:", err);
          return null;
        });
      
      if (!pingResponse || pingResponse.status !== "PONG") {
        console.warn("Content script not responding to ping properly:", pingResponse);
      } else {
        console.log("Content script is responsive in tab", tab.id);
      }
    } catch (err) {
      console.warn("Error checking content script:", err);
      // Continue anyway
    }
    
    // Request article extraction from content script
    const extractPromise = chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_ARTICLE" });
    const articleData = await Promise.race([extractPromise, timeout]);
    
    // Check for valid response
    if (!articleData) {
      throw new Error("No response from content script");
    }
    
    if (articleData.error) {
      throw new Error(articleData.error);
    }
    
    if (!articleData.text || articleData.text.length < 100) {
      throw new Error("Extracted content is too short or empty");
    }
    
    console.log("Article extraction successful:", {
      title: articleData.title,
      textLength: articleData.text.length
    });
    
    return articleData;
  } catch (error) {
    console.error('Error in article extraction:', error);
    throw new Error('Failed to extract article content: ' + error.message);
  }
}

/**
 * Fallback article extraction using executeScript to run in the page context
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<Object>} Extracted article data
 */
async function handleExtractArticleFallback(tab) {
  if (!tab || !tab.id) {
    throw new Error('No valid tab provided for fallback extraction');
  }

  console.log(`Attempting fallback extraction from tab ${tab.id}`);
  
  try {
    // Execute a script that directly extracts content in the page context
    const [extractionResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // In-page extraction function
        function extractTextFromPage() {
          try {
            // Helper to clean text
            function cleanText(text) {
              return text.replace(/\s+/g, ' ').trim();
            }
            
            // Extract title
            const title = document.title || '';
            
            // Try a variety of methods to extract content
            let content = '';
            
            // Method 1: Try article/main content selectors
            const contentSelectors = [
              'article', 'main', '[role="main"]', '.article', '.post', '.content',
              '#content', '.main-content', '.article-content', '.post-content'
            ];
            
            for (const selector of contentSelectors) {
              const element = document.querySelector(selector);
              if (element) {
                const text = element.innerText;
                if (text && text.length > 200) {
                  content = text;
                  break;
                }
              }
            }
            
            // Method 2: If no content yet, try all paragraphs
            if (!content || content.length < 200) {
              const paragraphs = Array.from(document.querySelectorAll('p'))
                .filter(p => p.innerText.length > 30) // Only substantive paragraphs
                .map(p => p.innerText.trim())
                .join('\n\n');
              
              if (paragraphs.length > 200) {
                content = paragraphs;
              }
            }
            
            // Method 3: Last resort, use body text
            if (!content || content.length < 200) {
              // Clone body to remove unwanted elements
              const bodyClone = document.body.cloneNode(true);
              
              // Remove clearly non-content elements
              const unwanted = bodyClone.querySelectorAll(
                'nav, header, footer, script, style, iframe, .nav, .menu, .header, .footer, .sidebar, .comments, aside'
              );
              unwanted.forEach(el => el.remove());
              
              content = bodyClone.innerText;
            }
            
            return { title, text: content, url: window.location.href };
          } catch (error) {
            return { error: error.message || 'Unknown error in extraction script' };
          }
        }
        
        return extractTextFromPage();
      }
    });
    
    if (!extractionResult || extractionResult.error) {
      throw new Error(extractionResult?.error || 'Failed to extract content from page');
    }
    
    const result = extractionResult.result;
    
    if (!result || !result.text || result.text.length < 100) {
      throw new Error('Extracted content is too short or empty from fallback method');
    }
    
    console.log('Fallback extraction successful:', {
      title: result.title,
      textLength: result.text.length
    });
    
    return result;
  } catch (error) {
    console.error('Error in fallback extraction:', error);
    throw new Error('Failed to extract content using fallback method: ' + error.message);
  }
}

/**
 * Save an article to local storage
 * @param {Object} articleData - Article data to save
 * @returns {Promise<Object>} Save result
 */
async function handleSaveArticle(articleData) {
  try {
    console.log('Saving article locally:', {
      title: articleData.title,
      url: articleData.url,
      contentLength: articleData.text ? articleData.text.length : 0
    });

    // Validate article data
    if (!articleData.text || articleData.text.length < 100) {
      throw new Error('Article content is too short or missing');
    }

    // Additional validation to detect if the content is likely minified JavaScript
    const jsDetectionPatterns = [
      // Check for common minified JS patterns
      /function\(\s*\)\s*{\s*['"]use strict['"]/,
      /new [A-Za-z]+\([a-z],[a-z],[a-z]\){/,
      /\([a-z],(?:\[[a-z]\]|\{[a-z]\}),[a-z]\)=>/,
      /var [a-zA-Z]{1,2}=function\(/,
      /var [a-zA-Z]{1,2}=/
    ];

    const jsSymbolDensityThreshold = 0.1; // 10% of content is JS-like symbols
    const jsSymbolCount = (articleData.text.match(/[{}();=><[\]]/g) || []).length;
    const jsSymbolDensity = jsSymbolCount / articleData.text.length;

    // Check for signs of minified JS
    const hasJsPatterns = jsDetectionPatterns.some(pattern => pattern.test(articleData.text));
    const hasHighSymbolDensity = jsSymbolDensity > jsSymbolDensityThreshold;

    if (hasJsPatterns && hasHighSymbolDensity) {
      console.error('Detected minified JavaScript instead of article content');
      throw new Error('Cannot save: Content appears to be JavaScript code rather than an article');
    }

    // Generate title if not provided
    if (!articleData.title) {
      console.log('Generating title for article content');
      try {
        articleData.title = await generateTitle(articleData.text);
      } catch (error) {
        console.error('Error generating title:', error);
        articleData.title = 'Untitled Article'; // Fallback title
      }
    }
    
    // Generate summary if needed
    if (!articleData.summary && articleData.text) {
      console.log('Generating summary for article content');
      try {
        articleData.summary = await generateSummary(articleData.text);
      } catch (error) {
        console.error('Error generating summary:', error);
        // Continue without a summary
      }
    }

    // Prepare article object for storage
    // Use current timestamp to generate a unique URL if needed
    let url = articleData.url;
    if (!url) {
      try {
        url = await getCurrentTabUrl();
      } catch (error) {
        console.warn('Could not get current tab URL:', error);
        // Generate a placeholder URL with timestamp
        url = `article-${new Date().getTime()}`;
      }
    }

    const articleToSave = {
      title: articleData.title,
      content: articleData.text,
      summary: articleData.summary,
      url: url,
      dateAdded: articleData.date || new Date().toISOString()
    };

    // Save article to IndexedDB
    const articleId = await saveArticle(articleToSave);

    console.log('Article saved successfully to local storage:', {
      article_id: articleId,
      title: articleToSave.title
    });

    // Return success with the saved article data
    return { 
      success: true, 
      article: {
        id: articleId,
        ...articleToSave
      }
    };
  } catch (error) {
    console.error('Error saving article:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Get the URL of the current active tab
 * @returns {Promise<string>} Current tab URL
 */
async function getCurrentTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) {
    return tabs[0].url;
  }
  return '';
}

// Initialize the extension
initialize();
