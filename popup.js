// popup.js

// Import the Supabase client
import supabase from './supabaseClient';

// Function to sign in with Google
async function signInWithGoogle() {
    console.log('Starting Google sign-in process...');
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

        // After successful sign in, update UI
        const session = await checkSession();
        if (session) {
            updateUIForAuthState(true, session.user.email);
            showStatus('Successfully signed in', 'success');
        }

        // Call handleUserLogin with the user data
        await handleUserLogin(sessionData.user);
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

// Session management functions
async function checkSession() {
    console.log('Checking current session status...');
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
        console.error('Error checking session:', error.message);
        return null;
    }
    
    if (session) {
        console.log('Active session found:', {
            user: session.user.email,
            expires_at: session.expires_at
        });
        return session;
    }
    
    console.log('No active session found');
    return null;
}

async function refreshSession() {
    console.log('Attempting to refresh session...');
    const { data: { session }, error } = await supabase.auth.refreshSession();
    
    if (error) {
        console.error('Session refresh failed:', error.message);
        return null;
    }
    
    if (session) {
        console.log('Session refreshed successfully:', {
            user: session.user.email,
            new_expires_at: new Date(session.expires_at).toLocaleString()
        });
        return session;
    }
    
    console.log('No session to refresh');
    return null;
}

async function handleSignOut() {
    console.log('Initiating sign out process...');
    const { error } = await supabase.auth.signOut();
    
    if (error) {
        console.error('Sign out failed:', error.message);
        showStatus('Failed to sign out', 'error');
        return;
    }
    
    console.log('User signed out successfully');
    showStatus('Signed out successfully', 'success');
    updateUIForAuthState(false);
}

function updateUIForAuthState(isAuthenticated, userEmail = null) {
    console.log('Updating UI for auth state:', { isAuthenticated, userEmail });
    
    const signInButton = document.getElementById('sign-in-button');
    const saveArticleBtn = document.getElementById('saveArticleBtn');
    const showArticlesBtn = document.getElementById('showArticlesBtn');
    
    if (isAuthenticated) {
        signInButton.textContent = `Sign out (${userEmail})`;
        signInButton.removeEventListener('click', signInWithGoogle);
        signInButton.addEventListener('click', handleSignOut);
        
        saveArticleBtn.disabled = false;
        showArticlesBtn.disabled = false;
    } else {
        signInButton.textContent = 'Sign in with Google';
        signInButton.removeEventListener('click', handleSignOut);
        signInButton.addEventListener('click', signInWithGoogle);
        
        saveArticleBtn.disabled = true;
        showArticlesBtn.disabled = true;
    }
}

// Initialize the extension
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Extension popup opened, initializing...');
    
    // Check for existing session
    const session = await checkSession();
    if (session) {
        console.log('Found existing session, updating UI...');
        updateUIForAuthState(true, session.user.email);
        
        // Set up session refresh
        const timeToExpiry = new Date(session.expires_at) - new Date();
        if (timeToExpiry > 0) {
            console.log(`Session expires in ${Math.round(timeToExpiry/1000/60)} minutes`);
            setTimeout(refreshSession, timeToExpiry - (5 * 60 * 1000)); // Refresh 5 minutes before expiry
        } else {
            console.log('Session expired, attempting refresh...');
            await refreshSession();
        }
    } else {
        console.log('No existing session found, showing sign-in UI');
        updateUIForAuthState(false);
    }
    
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
                const session = await checkSession(); // Check if the user is authenticated
                if (!session) {
                    showStatus("You must be signed in to save an article.", "error");
                    return; // Exit the function if not authenticated
                }

                const response = await chrome.runtime.sendMessage({
                    action: "SAVE_ARTICLE",
                    payload: {
                        title: articleData.title,
                        text: articleData.text,
                        date: new Date().toISOString()
                    }
                });

                console.log("Response from background script:", response);

                if (response?.success) {
                    showStatus("Article saved successfully!", "success");
                } else {
                    console.error("Error details:", response);
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

async function handleUserLogin(userData) {
    // Define the session duration (e.g., 1 hour)
    const sessionDuration = 60 * 60 * 1000; // 1 hour in milliseconds

    // Create the session object with numeric timestamp for consistency
    const currentSession = {
        user: userData.email,
        expires_at: Date.now() + sessionDuration // Store as timestamp
    };

    // Store the session in chrome.storage
    await chrome.storage.local.set({ currentSession });

    // Notify background script of session update
    await chrome.runtime.sendMessage({
        type: 'AUTH_STATE_CHANGED',
        payload: {
            event: 'SIGNED_IN',
            session: currentSession
        }
    });

    console.log("User logged in. Session created:", {
        user: currentSession.user,
        expires_at: new Date(currentSession.expires_at).toISOString()
    });
}
