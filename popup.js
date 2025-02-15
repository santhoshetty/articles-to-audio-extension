// popup.js

// Import the Supabase client
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'https://vrsbermuilpkvjdnnhtf.supabase.co'; // Replace with your Supabase URL
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc2Jlcm11aWxwa3ZqZG5uaHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2MDIwMDIsImV4cCI6MjA1NTE3ODAwMn0.VzGpAOUX-M147mIeEBcWAp_P3eABS1QnDzmN4Yn-I_k'; // Replace with your Supabase public anon key
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to sign in with Google
async function signInWithGoogle() {
    console.log('signInWithGoogle function called');
    try {
        console.log('Starting Google sign-in process...');
        
        // Get the extension ID and redirect URL
        const extensionId = chrome.runtime.id;
        const redirectUrl = chrome.identity.getRedirectURL();
        console.log('Extension ID:', extensionId);
        console.log('Redirect URL:', redirectUrl);

        // Initialize Supabase OAuth
        console.log('Initializing Supabase OAuth...');
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
                skipBrowserRedirect: true,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });

        if (error) {
            console.error('Supabase OAuth initialization error:', error);
            showStatus('Failed to initiate sign in', 'error');
            return;
        }

        // Get the authorization URL from Supabase's response
        const authURL = data.url;
        console.log('Got auth URL from Supabase:', authURL);
        
        // Use Chrome's identity API to handle the OAuth flow
        console.log('Launching web auth flow...');
        const responseUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow({
                url: authURL,
                interactive: true
            }, (redirectUrl) => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome web auth flow error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }
                console.log('Got redirect URL:', redirectUrl);
                resolve(redirectUrl);
            });
        });

        if (!responseUrl) {
            console.error('No response URL received from auth flow');
            throw new Error('No response URL received');
        }

        console.log('Parsing response URL:', responseUrl);
        // Extract the access_token and refresh_token from the URL
        const url = new URL(responseUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        console.log('Access token present:', !!access_token);
        console.log('Refresh token present:', !!refresh_token);

        if (!access_token) {
            console.error('No access token in response URL');
            throw new Error('No access token received');
        }

        // Set the session in Supabase
        console.log('Setting Supabase session...');
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token
        });

        if (sessionError) {
            console.error('Error setting Supabase session:', sessionError);
            showStatus('Failed to complete sign in', 'error');
            return;
        }

        console.log('Successfully set Supabase session:', sessionData);
        showStatus('Successfully signed in with Google', 'success');
        
        // Store the session
        await chrome.storage.local.set({ 
            session: sessionData.session 
        });
        console.log('Stored session in chrome.storage.local');
    } catch (error) {
        console.error('Detailed error in sign in process:', error);
        console.error('Error stack:', error.stack);
        showStatus('An error occurred during sign in', 'error');
    }
}

// Function to show status messages
function showStatus(message, type) {
    const statusMessage = document.getElementById("statusMessage");
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 3000);
}

async function summarizeText(text) {
    // Get API key from storage
    const storage = await chrome.storage.local.get(['openaiKey']);
    if (!storage.openaiKey) {
        throw new Error("OpenAI API key not found. Please set it in the extension options.");
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storage.openaiKey}`  // Use key from storage
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{
                    role: 'system',
                    content: 'Summarize the following article in a concise way:'
                }, {
                    role: 'user',
                    content: text
                }],
                max_tokens: 300
            })
        });
        
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Summarization failed:', error);
        throw error;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded event fired');
    
    const saveArticleBtn = document.getElementById('saveArticleBtn');
    const showArticlesBtn = document.getElementById('showArticlesBtn');
    const signInButton = document.getElementById('sign-in-button');
    const optionsLink = document.getElementById('optionsLink');
    
    console.log('Buttons found:', {
        saveArticleBtn: !!saveArticleBtn,
        showArticlesBtn: !!showArticlesBtn,
        signInButton: !!signInButton,
        optionsLink: !!optionsLink
    });

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
                console.log("Current tab:", tab.id);

                // 2. Ensure content script is injected
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['contentScript.js']
                    });
                    console.log("Content script injected");
                } catch (err) {
                    console.log("Content script already exists or injection failed:", err);
                }

                // 3. Extract article content
                const articleData = await chrome.tabs.sendMessage(tab.id, { 
                    action: "EXTRACT_ARTICLE" 
                }).catch(err => {
                    console.error("Failed to send message to content script:", err);
                    throw new Error("Failed to extract article. Make sure you're on an article page.");
                });

                console.log("Extracted article data:", articleData);

                if (!articleData || !articleData.text) {
                    alert("No article text found. Make sure you're on an article page.");
                    return;
                }

                // 4. Save the article
                const response = await chrome.runtime.sendMessage({
                    action: "SAVE_ARTICLE",
                    payload: {
                        title: articleData.title,
                        text: articleData.text,
                        date: new Date().toISOString()
                    }
                });

                if (response?.success) {
                    showStatus("Article saved successfully!", "success");
                } else {
                    showStatus("Failed to save the article.", "error");
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

    if (signInButton) {
        signInButton.addEventListener('click', () => {
            console.log('Sign in button clicked');
            signInWithGoogle();
        });
    }

    if (optionsLink) {
        optionsLink.addEventListener('click', (e) => {
            console.log('Options link clicked');
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }

    // Check if API key exists
    const storage = await chrome.storage.local.get(['openaiKey']);
    if (!storage.openaiKey) {
        alert('Please set your OpenAI API key in the extension settings first.');
        chrome.runtime.openOptionsPage();
        return;
    }
});
