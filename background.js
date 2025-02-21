// background.js

// Import the Supabase client
import supabase from './supabaseClient';

// Session management
let currentSession = null;
let sessionInitialized = false;

async function initializeSession() {
    console.log('Initializing session in background...');
    
    try {
        // First check if we have a session in chrome.storage.local
        const storedSession = await chrome.storage.local.get('supabase.auth.token');
        if (storedSession && storedSession['supabase.auth.token']) {
            console.log('Found stored session in chrome.storage.local');
        }
        
        // Check Supabase session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Error getting Supabase session:', error.message);
            currentSession = null;
            sessionInitialized = true;
            // Clear any stored session data if there's an error
            await chrome.storage.local.remove('supabase.auth.token');
            return;
        }
        
        if (session) {
            console.log('Supabase session found:', {
                user: session.user.email,
                user_id: session.user.id,
                expires_at: session.expires_at
            });
            currentSession = session;
            sessionInitialized = true;
            
            // Store the session in chrome.storage.local
            await chrome.storage.local.set({
                'supabase.auth.token': session
            });
            
            // Set up session refresh before expiry
            const expiresAt = new Date(session.expires_at).getTime();
            const now = new Date().getTime();
            const timeToExpiry = expiresAt - now;
            
            if (timeToExpiry > 0) {
                setTimeout(async () => {
                    console.log('Refreshing session...');
                    const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
                    if (!refreshError && refreshedSession) {
                        currentSession = refreshedSession;
                        broadcastAuthStateChange('REFRESHED', refreshedSession);
                    }
                }, Math.max(0, timeToExpiry - (5 * 60 * 1000))); // Refresh 5 minutes before expiry
            }
            
            return;
        }
        
        console.log('No valid Supabase session found');
        currentSession = null;
        sessionInitialized = true;
        await chrome.storage.local.remove('supabase.auth.token');
    } catch (error) {
        console.error('Error in initializeSession:', error);
        currentSession = null;
        sessionInitialized = true;
        await chrome.storage.local.remove('supabase.auth.token');
    }
}

// Initialize session when extension loads
initializeSession().catch(error => {
    console.error('Failed to initialize session:', error);
    sessionInitialized = true;
});

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
    console.log('Supabase auth state changed:', {
        event,
        has_session: !!session,
        user: session?.user?.email
    });
    
    currentSession = session;
    
    // Store the session in chrome.storage.local
    if (session) {
        chrome.storage.local.set({
            'supabase.auth.token': session
        }).catch(error => {
            console.error('Error storing session:', error);
        });
    } else {
        chrome.storage.local.remove('supabase.auth.token').catch(error => {
            console.error('Error removing session:', error);
        });
    }
    
    broadcastAuthStateChange(event, session);
});

// Helper function to broadcast auth state changes
function broadcastAuthStateChange(event, session) {
    // Check if we're in the middle of authentication
    chrome.storage.local.get('auth_in_progress').then(({ auth_in_progress }) => {
        if (!auth_in_progress) {
            chrome.runtime.sendMessage({
                type: 'AUTH_STATE_CHANGED',
                payload: { event, session }
            }).catch(error => {
                // Ignore errors from no listeners
                if (!error.message.includes('Could not establish connection')) {
                    console.error('Error broadcasting auth state:', error);
                }
            });
        }
    });
}

// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action || request.type);
    
    if (request.type === 'AUTH_STATE_CHANGED') {
        console.log('Auth state changed:', request.payload);
        currentSession = request.payload.session;
        sessionInitialized = true;
        
        // Store the session
        if (request.payload.session) {
            chrome.storage.local.set({
                'supabase.auth.token': request.payload.session
            }).catch(error => {
                console.error('Error storing session:', error);
            });
        }
        
        sendResponse({ success: true });
        return true;
    }
    
    if (request.action === "GET_SESSION") {
        // If session isn't initialized yet, wait for it
        if (!sessionInitialized) {
            initializeSession()
                .then(() => sendResponse({ session: currentSession }))
                .catch(error => {
                    console.error('Error getting session:', error);
                    sendResponse({ session: null, error: error.message });
                });
            return true;
        }
        
        // Session is already initialized, respond immediately
        sendResponse({ session: currentSession });
        return true;
    }
    
    if (request.action === "SAVE_ARTICLE") {
        if (!currentSession) {
            console.error('Attempting to save article without authentication');
            console.log('Current session:', currentSession);
            sendResponse({ success: false, error: 'Authentication required' });
            return true;
        }
        
        handleSaveArticle(request.payload)
            .then(result => sendResponse(result))
            .catch(error => {
                console.error('Error saving article:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
    
    if (request.action === "GOOGLE_SIGN_IN") {
        handleGoogleSignIn()
            .then(result => sendResponse(result))
            .catch(error => {
                console.error('Error in Google sign-in:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;  // Keep the message channel open for async response
    }
});

async function handleSaveArticle(articleData) {
    try {
        console.log('Attempting to save article to Supabase:', {
            title: articleData.title,
            date: articleData.date
        });

        // Get the latest session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
            console.error('Session error:', sessionError);
            throw new Error('No valid session found');
        }

        // Update current session
        currentSession = session;

        // Debug log for user ID and session details
        console.log('Current user session details:', {
            user_id: session.user.id,
            email: session.user.email,
            session_expires_at: session.expires_at,
            access_token: session.access_token ? 'Present' : 'Missing'
        });

        // Insert the article with detailed error logging
        const { data, error } = await supabase
            .from('articles')
            .insert([
                {
                    title: articleData.title,
                    content: articleData.text,
                    user_id: session.user.id,
                    created_at: articleData.date
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Supabase error details:', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
                status: error.status
            });
            throw new Error(`Failed to save article to database: ${error.message}`);
        }

        console.log('Article saved successfully to Supabase:', {
            article_id: data.id,
            title: data.title,
            created_at: data.created_at,
            user_id: data.user_id
        });

        // Return success with the saved article data
        return { 
            success: true, 
            article: data 
        };
    } catch (error) {
        console.error('Error in handleSaveArticle:', error);
        // Include more context in the error message
        const errorMessage = error.message || 'Unknown error occurred';
        throw new Error(`Failed to save article: ${errorMessage}`);
    }
}

// Add this new function for handling Google sign-in
async function handleGoogleSignIn() {
    console.log('Background: Starting Google sign-in process...');
    try {
        const redirectUrl = chrome.identity.getRedirectURL();
        console.log('Redirect URL:', redirectUrl);

        // Initialize Supabase OAuth
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
            console.error('Background: Supabase OAuth initialization error:', error);
            throw error;
        }

        const authURL = data.url;
        console.log('Background: Got auth URL from Supabase');
        
        // Use Chrome's identity API to handle the OAuth flow
        const responseUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow({
                url: authURL,
                interactive: true
            }, (redirectUrl) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(redirectUrl);
            });
        });

        if (!responseUrl) {
            throw new Error('No response URL received');
        }

        // Extract tokens from URL
        const url = new URL(responseUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (!access_token) {
            throw new Error('No access token received');
        }

        // Set the session in Supabase
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token
        });

        if (sessionError) {
            throw sessionError;
        }

        // Store session
        currentSession = sessionData.session;
        await chrome.storage.local.set({
            'supabase.auth.token': sessionData.session
        });

        // Broadcast the auth state change
        broadcastAuthStateChange('SIGNED_IN', sessionData.session);

        return { success: true, session: sessionData.session };
    } catch (error) {
        console.error('Background: Error in Google sign-in process:', error);
        return { success: false, error: error.message };
    }
}
