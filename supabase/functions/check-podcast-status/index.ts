import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Log request received
    console.log("Check podcast status function called");
    
    // Get the job ID from the request
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    
    if (!jobId) {
      console.error("Missing job ID");
      throw new Error("Job ID is required");
    }
    
    console.log("Checking status for job ID:", jobId);

    // Get Supabase client from the request context
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase configuration");
      throw new Error("Supabase configuration is incomplete");
    }

    // Log incoming headers for debugging
    const authHeader = req.headers.get('Authorization');
    console.log('Incoming headers:', {
      authorization: authHeader ? `${authHeader.substring(0, 20)}...` : 'No Bearer token',
      contentType: req.headers.get('Content-Type'),
      allHeaders: Object.fromEntries([...req.headers.entries()])
    });

    if (!authHeader) {
      throw new Error('No authorization header provided');
    }

    // Extract user ID from JWT token
    const jwt = authHeader.replace('Bearer ', '');
    const base64Url = jwt.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const { sub: userId } = JSON.parse(jsonPayload);
    console.log("Extracted user ID from token:", userId);

    // Initialize Supabase client with user's auth token
    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    // Get job status
    const { data: jobData, error: jobError } = await supabaseClient
      .from('podcast_jobs')
      .select('*, processing_logs(*)')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (jobError) {
      console.error("Error fetching job status:", jobError);
      throw new Error(`Failed to fetch job status: ${jobError.message}`);
    }

    if (!jobData) {
      console.error("Job not found or not owned by user");
      throw new Error("Job not found or not owned by user");
    }

    console.log("Retrieved job status:", jobData);

    // If job is completed, get the audio file information
    let audioData = null;
    if (jobData.status === 'completed') {
      // Get the most recent audio file created for this user
      const { data: audioFiles, error: audioError } = await supabaseClient
        .from('audio_files')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (audioError) {
        console.error("Error fetching audio file:", audioError);
      } else if (audioFiles && audioFiles.length > 0) {
        audioData = audioFiles[0];
        console.log("Retrieved audio file:", audioData);
      }
    }

    // Return job status and audio file information if available
    return new Response(
      JSON.stringify({ 
        job: {
          id: jobData.id,
          status: jobData.status,
          script_status: jobData.script_status,
          created_at: jobData.created_at,
          updated_at: jobData.updated_at,
          processing_started_at: jobData.processing_started_at,
          processing_completed_at: jobData.processing_completed_at
        },
        audio: audioData,
        logs: jobData.processing_logs,
        success: true 
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        } 
      }
    );
  } catch (error) {
    // Enhanced error logging
    console.error('Error in check-podcast-status function:', {
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });

    // Return detailed error response
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false,
        details: {
          type: error.name,
          cause: error.cause
        }
      }),
      { 
        status: 400, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        } 
      }
    );
  }
}) 