// background.js

// Import the Supabase client
import supabase from './supabaseClient';

// Session management
let currentSession = null;
let sessionInitialized = false;

async function initializeSession() {
    console.log('Initializing session in background...');
    
    try {
        // Check Supabase session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Error getting Supabase session:', error.message);
            currentSession = null;
            sessionInitialized = true;
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
            return;
        }
        
        console.log('No valid Supabase session found');
        currentSession = null;
        sessionInitialized = true;
    } catch (error) {
        console.error('Error in initializeSession:', error);
        currentSession = null;
        sessionInitialized = true;
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
    broadcastAuthStateChange(event, session);
});

// Helper function to broadcast auth state changes
function broadcastAuthStateChange(event, session) {
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

// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action || request.type);
    
    if (request.type === 'AUTH_STATE_CHANGED') {
        console.log('Auth state changed:', request.payload);
        currentSession = request.payload.session;
        sessionInitialized = true;
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
