import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'https://vrsbermuilpkvjdnnhtf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc2Jlcm11aWxwa3ZqZG5uaHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2MDIwMDIsImV4cCI6MjA1NTE3ODAwMn0.VzGpAOUX-M147mIeEBcWAp_P3eABS1QnDzmN4Yn-I_k';

// Create a single supabase client instance
const supabase = createClient(supabaseUrl, supabaseKey);

// Export the instance as default
export default supabase; 