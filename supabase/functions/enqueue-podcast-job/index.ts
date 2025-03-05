import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

// GCP Cloud Function URL
const GCP_FUNCTION_URL = Deno.env.get('GCP_FUNCTION_URL') || '';

serve(async (req) => {
  try {
    // Log request received
    console.log("Enqueue podcast job function called");
    
    // Get the articles from the request body
    const { articles } = await req.json();
    console.log("Received articles:", JSON.stringify(articles, null, 2));
    
    if (!articles || !Array.isArray(articles)) {
      console.error("Invalid articles format:", articles);
      throw new Error("Articles must be an array");
    }

    if (articles.length === 0) {
      console.error("Empty articles array");
      throw new Error("At least one article is required");
    }

    // Validate article structure
    articles.forEach((article, index) => {
      if (!article.id) {
        throw new Error(`Article at index ${index} is missing an id`);
      }
      if (!article.title) {
        throw new Error(`Article at index ${index} is missing a title`);
      }
      if (!article.content && !article.summary) {
        throw new Error(`Article at index ${index} is missing both content and summary`);
      }
    });

    // Get Supabase client from the request context
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
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

    // Initialize Supabase admin client with service role key
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceKey
    );

    // Create a new podcast job entry
    const { data: jobData, error: jobError } = await supabaseAdmin
      .from('podcast_jobs')
      .insert({
        user_id: userId,
        status: 'pending',
        processing_mode: 'gcp',
        script_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) {
      console.error("Error creating podcast job:", jobError);
      throw new Error(`Failed to create podcast job: ${jobError.message}`);
    }

    console.log("Created podcast job:", jobData);

    // Send the job to GCP Cloud Function
    if (!GCP_FUNCTION_URL) {
      throw new Error("GCP_FUNCTION_URL environment variable is not set");
    }

    console.log(`Sending job to GCP Cloud Function: ${GCP_FUNCTION_URL}`);

    const gcpResponse = await fetch(GCP_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        articles,
        jobId: jobData.id,
        userId,
        authToken: jwt
      })
    });

    if (!gcpResponse.ok) {
      const errorText = await gcpResponse.text();
      console.error(`Error from GCP Cloud Function: ${gcpResponse.status} ${errorText}`);
      
      // Update job status to failed
      await supabaseAdmin
        .from('podcast_jobs')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', jobData.id);
        
      // Log the error
      await supabaseAdmin
        .from('processing_logs')
        .insert({
          job_id: jobData.id,
          event_type: 'enqueue_failed',
          message: `Failed to enqueue job to GCP: ${gcpResponse.status}`,
          details: { error: errorText },
          timestamp: new Date().toISOString()
        });
        
      throw new Error(`Failed to enqueue job to GCP: ${gcpResponse.status} ${errorText}`);
    }

    const gcpData = await gcpResponse.json();
    console.log("GCP Cloud Function response:", gcpData);

    // Update job with GCP job ID if provided
    if (gcpData.gcp_job_id) {
      await supabaseAdmin
        .from('podcast_jobs')
        .update({
          gcp_job_id: gcpData.gcp_job_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobData.id);
    }

    // Log successful enqueue
    await supabaseAdmin
      .from('processing_logs')
      .insert({
        job_id: jobData.id,
        event_type: 'enqueued',
        message: 'Successfully enqueued job to GCP',
        details: { gcp_response: gcpData },
        timestamp: new Date().toISOString()
      });

    // Return success response with job ID
    return new Response(
      JSON.stringify({ 
        job_id: jobData.id,
        success: true 
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        } 
      }
    );
  } catch (error) {
    // Enhanced error logging
    console.error('Error in enqueue-podcast-job function:', {
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
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        } 
      }
    );
  }
}) 