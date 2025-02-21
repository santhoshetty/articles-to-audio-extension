import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'https://vrsbermuilpkvjdnnhtf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc2Jlcm11aWxwa3ZqZG5uaHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2MDIwMDIsImV4cCI6MjA1NTE3ODAwMn0.VzGpAOUX-M147mIeEBcWAp_P3eABS1QnDzmN4Yn-I_k';

// Create a single supabase client instance with storage options
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: {
            getItem: (key) => {
                try {
                    return chrome.storage.local.get(key).then(data => data[key]);
                } catch (error) {
                    console.error('Error getting auth data:', error);
                    return null;
                }
            },
            setItem: (key, value) => {
                try {
                    return chrome.storage.local.set({ [key]: value });
                } catch (error) {
                    console.error('Error setting auth data:', error);
                }
            },
            removeItem: (key) => {
                try {
                    return chrome.storage.local.remove(key);
                } catch (error) {
                    console.error('Error removing auth data:', error);
                }
            }
        }
    }
});

// Export the instance as default
export default supabase; 