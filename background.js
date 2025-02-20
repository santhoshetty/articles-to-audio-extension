// background.js

// Import the Supabase client
import supabase from './supabaseClient';

// Session management
let currentSession = null;

async function initializeSession() {
    console.log('Initializing session in background...');
    
    // First check Supabase session
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
        console.error('Error getting session:', error.message);
        return;
    }
    
    if (session) {
        console.log('Supabase session found in background:', {
            user: session.user.email,
            expires_at: session.expires_at
        });
        currentSession = session;
        setupSessionRefresh(session);
        return;
    }
    
    // If no Supabase session, check local storage
    try {
        const storage = await chrome.storage.local.get(['currentSession']);
        if (storage.currentSession) {
            const localSession = storage.currentSession;
            const expiryDate = new Date(localSession.expires_at);
            
            if (expiryDate > new Date()) {
                console.log('Local storage session found:', localSession);
                currentSession = localSession;
                return;
            } else {
                console.log('Local storage session expired');
                await chrome.storage.local.remove(['currentSession']);
            }
        }
    } catch (err) {
        console.error('Error checking local storage session:', err);
    }
    
    console.log('No valid session found in background');
    currentSession = null;
}

function setupSessionRefresh(session) {
    const timeToExpiry = new Date(session.expires_at) - new Date();
    if (timeToExpiry > 0) {
        console.log(`Background: Session expires in ${Math.round(timeToExpiry/1000/60)} minutes`);
        setTimeout(async () => {
            console.log('Background: Attempting to refresh session...');
            const { data: { session: newSession }, error } = await supabase.auth.refreshSession();
            
            if (error) {
                console.error('Background: Session refresh failed:', error.message);
                currentSession = null;
                return;
            }
            
            if (newSession) {
                console.log('Background: Session refreshed successfully');
                currentSession = newSession;
                setupSessionRefresh(newSession);
            }
        }, timeToExpiry - (5 * 60 * 1000)); // Refresh 5 minutes before expiry
    }
}

// Initialize session when extension loads
initializeSession();

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
    console.log('Auth state changed:', event, session ? 'Session exists' : 'No session');
    
    if (session) {
        currentSession = session;
        setupSessionRefresh(session);
    } else {
        currentSession = null;
    }
    
    // Broadcast auth state change to all extension pages
    chrome.runtime.sendMessage({
        type: 'AUTH_STATE_CHANGED',
        payload: {
            event,
            session
        }
    }).catch(error => {
        // Ignore errors from no listeners
        if (!error.message.includes('Could not establish connection')) {
            console.error('Error broadcasting auth state:', error);
        }
    });
});

// Handle messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action);
    
    if (request.action === "GET_SESSION") {
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
        
        // Check if session is expired
        const expiryDate = new Date(currentSession.expires_at);
        if (expiryDate <= new Date()) {
            console.error('Session expired');
            currentSession = null;
            sendResponse({ success: false, error: 'Session expired' });
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
});

async function handleSaveArticle(articleData) {
    try {
        // Get existing articles
        const storage = await chrome.storage.local.get(['articles']);
        const articles = storage.articles || [];

        // Add new article
        articles.push({
            title: articleData.title,
            text: articleData.text,
            date: articleData.date
        });

        // Save back to storage
        await chrome.storage.local.set({ articles });
        
        console.log("Article saved successfully:", articleData.title);
        return { success: true };
    } catch (error) {
        console.error("Error saving article:", error);
        throw error;
    }
}
