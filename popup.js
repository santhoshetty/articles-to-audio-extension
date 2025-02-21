// popup.js

// Import the Supabase client
import supabase from './supabaseClient';

// Function to sign in with Google
async function signInWithGoogle() {
    console.log('Popup: Starting Google sign-in process...');
    try {
        // Disable the sign-in button and show loading state
        const signInButton = document.getElementById('sign-in-button');
        signInButton.disabled = true;
        signInButton.textContent = 'Signing in...';
        
        // Set auth in progress flag
        await chrome.storage.local.set({ auth_in_progress: true });
        
        // Delegate sign-in to background script
        const response = await chrome.runtime.sendMessage({ action: "GOOGLE_SIGN_IN" });
        console.log('Popup: Received sign-in response:', response);
        
        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to sign in');
        }
        
        console.log('Popup: Sign-in successful');
        
        // Update UI with the new session
        updateUIForAuthState(true, response.session.user.email);
        showStatus('Successfully signed in with Google', 'success');
        
    } catch (error) {
        console.error('Popup: Error in sign-in process:', error);
        showStatus(error.message || 'Failed to sign in', 'error');
        updateUIForAuthState(false);
    } finally {
        // Clear auth in progress flag
        await chrome.storage.local.remove('auth_in_progress');
        // Re-enable the sign-in button and restore text
        const signInButton = document.getElementById('sign-in-button');
        signInButton.disabled = false;
        signInButton.textContent = 'Sign in with Google';
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
    
    try {
        // First check if we have a session in chrome.storage.local
        const storedSession = await chrome.storage.local.get('supabase.auth.token');
        let session = storedSession['supabase.auth.token'];
        
        if (!session) {
            // If no stored session, check with background script
            const response = await chrome.runtime.sendMessage({ action: "GET_SESSION" });
            session = response.session;
        }
        
        if (session) {
            console.log('Found existing session, updating UI...');
            updateUIForAuthState(true, session.user.email);
            
            // Verify the session is still valid
            const now = new Date().getTime();
            const expiresAt = new Date(session.expires_at).getTime();
            
            if (now >= expiresAt) {
                console.log('Session expired, attempting refresh...');
                const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
                
                if (!refreshError && refreshData.session) {
                    session = refreshData.session;
                    await chrome.storage.local.set({
                        'supabase.auth.token': session
                    });
                    updateUIForAuthState(true, session.user.email);
                } else {
                    console.log('Session refresh failed, showing sign-in UI');
                    updateUIForAuthState(false);
                }
            }
        } else {
            console.log('No existing session found, showing sign-in UI');
            updateUIForAuthState(false);
        }
    } catch (error) {
        console.error('Error during popup initialization:', error);
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
});

async function handleUserLogin(userData) {
    try {
        // Notify background script of successful login
        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await chrome.runtime.sendMessage({
            type: 'AUTH_STATE_CHANGED',
            payload: {
                event: 'SIGNED_IN',
                session
            }
        });

        if (!response?.success) {
            console.error('Failed to update background script session state');
        }

        console.log("User logged in. Supabase session active:", {
            user: userData.email,
            expires_at: session.expires_at
        });
    } catch (error) {
        console.error('Error handling user login:', error);
        throw error;
    }
}
