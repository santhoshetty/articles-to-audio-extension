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

        // Ensure we have a valid session with user information
        if (!currentSession?.user?.id) {
            throw new Error('No valid user session found');
        }

        // Debug log for user ID
        console.log('Current user session details:', {
            user_id: currentSession.user.id,
            email: currentSession.user.email
        });

        // First, ensure user exists in the users table
        const { error: upsertError } = await supabase
            .from('users')
            .upsert([
                {
                    id: currentSession.user.id,
                    email: currentSession.user.email,
                    created_at: new Date().toISOString()
                }
            ], {
                onConflict: 'id'
            });

        if (upsertError) {
            console.error('Error upserting user record:', upsertError);
            throw new Error('Failed to create/update user record');
        }

        // Now insert the article
        const { data, error } = await supabase
            .from('articles')
            .insert([
                {
                    title: articleData.title,
                    content: articleData.text,
                    user_id: currentSession.user.id,
                    created_at: articleData.date
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Supabase error while saving article:', error);
            throw new Error('Failed to save article to database');
        }

        console.log('Article saved successfully to Supabase:', {
            article_id: data.id,
            title: data.title,
            created_at: data.created_at
        });

        // Return success with the saved article data
        return { 
            success: true, 
            article: data 
        };
    } catch (error) {
        console.error('Error in handleSaveArticle:', error);
        throw error;
    }
}
