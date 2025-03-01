import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Log request received
    console.log("Process podcast audio function called")
    
    // Get the podcast script and metadata from the request body
    const { podcastScript, scriptId, podcastId, podcastLengthMinutes } = await req.json()
    
    if (!podcastScript) {
      console.error("Missing podcast script")
      throw new Error("Podcast script is required")
    }

    if (!scriptId) {
      console.error("Missing script ID")
      throw new Error("Script ID is required")
    }

    if (!podcastId) {
      console.error("Missing podcast ID")
      throw new Error("Podcast ID is required")
    }

    // Initialize OpenAI with the API key from edge function secrets
    const apiKey = Deno.env.get('openai_api_key')
    if (!apiKey) {
      console.error("OpenAI API key not found in environment")
      throw new Error("OpenAI API key not configured")
    }

    const openai = new OpenAI({ apiKey })

    // Get Supabase client from the request context
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error("Missing Supabase configuration")
      throw new Error("Supabase configuration is incomplete")
    }

    // Log incoming headers for debugging
    const authHeader = req.headers.get('Authorization')
    console.log('Incoming headers:', {
      authorization: authHeader ? `${authHeader.substring(0, 20)}...` : 'No Bearer token',
      contentType: req.headers.get('Content-Type')
    })

    if (!authHeader) {
      throw new Error('No authorization header provided')
    }

    // Extract user ID from JWT token
    const jwt = authHeader.replace('Bearer ', '')
    const base64Url = jwt.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    }).join(''))

    const { sub: userId } = JSON.parse(jsonPayload)
    console.log("Extracted user ID from token:", userId)

    // Initialize Supabase clients
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
    )

    // Service role client for storage operations
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceKey
    )

    // Determine optimal chunk size for the podcast script
    // A good estimate is approximately 1000-1500 characters per minute of audio
    const charsPerMinute = 1200 // This is an estimate and may need adjustment
    const totalEstimatedChars = podcastLengthMinutes * charsPerMinute
    
    // Aim for chunks that can be processed within the 50s edge function time limit
    // We'll decrease the chunk size as the total content grows to prevent timeouts
    let targetChunkSize = 3500 // Characters per chunk - base value
    
    // For longer podcasts, reduce chunk size to ensure processing completes within time limits
    if (podcastLengthMinutes > 10) {
      targetChunkSize = 3000
    }
    if (podcastLengthMinutes > 15) {
      targetChunkSize = 2500
    }
    if (podcastLengthMinutes > 20) {
      targetChunkSize = 2000
    }
    
    console.log(`Using target chunk size of ${targetChunkSize} characters for ${podcastLengthMinutes} minute podcast`)
    
    // First clean the script to normalize newlines
    const cleanedScript = podcastScript.replace(/\\n/g, "\n").trim()
    
    // Calculate number of chunks needed
    const estimatedChunks = Math.ceil(cleanedScript.length / targetChunkSize)
    console.log(`Podcast script is ${cleanedScript.length} characters, estimating ${estimatedChunks} chunks`)

    // Create a new job in the podcast_jobs table
    const { data: jobData, error: jobError } = await supabaseClient
      .from('podcast_jobs')
      .insert({
        podcast_id: podcastId,
        status: 'processing',
        total_chunks: estimatedChunks,
        completed_chunks: 0,
        user_id: userId
      })
      .select()
      .single()

    if (jobError) {
      console.error("Error creating podcast job:", jobError)
      throw new Error(`Failed to create podcast job: ${jobError.message}`)
    }

    const jobId = jobData.id
    console.log(`Created podcast job with ID: ${jobId}`)

    // Split podcast script into chunks
    const scriptChunks = []
    
    // Splitting strategy: try to split on complete dialogue segments
    // Look for patterns like "Alice:" or "Bob:" to find good split points
    let currentPos = 0
    
    while (currentPos < cleanedScript.length) {
      // Calculate a safe end position that's well below the API limit
      let endPos = Math.min(currentPos + targetChunkSize, cleanedScript.length)
      
      // If we're not at the end of the script, try to find a good split point
      if (endPos < cleanedScript.length) {
        // Try to find natural dialogue breaks in a window around our target position
        // Look for speaker markers like "Alice:" or "Bob:" 
        // Start from targetChunkSize and look for the first speaker marker
        const searchWindowStart = Math.max(currentPos + targetChunkSize * 0.8, currentPos); // Look within last 20% of chunk
        const searchWindowEnd = Math.min(currentPos + targetChunkSize * 1.2, cleanedScript.length); // Or up to 20% past target
        
        // Search for common speaker patterns in the window
        const speakerMarkers = ["Alice:", "Bob:"];
        let bestSplitPos = -1;
        
        for (const marker of speakerMarkers) {
          let markerPos = cleanedScript.indexOf(marker, searchWindowStart);
          // Find the first occurrence in our search window
          while (markerPos !== -1 && markerPos < searchWindowEnd) {
            if (bestSplitPos === -1 || markerPos < bestSplitPos) {
              bestSplitPos = markerPos;
            }
            // Look for the next occurrence
            markerPos = cleanedScript.indexOf(marker, markerPos + 1);
          }
        }
        
        if (bestSplitPos !== -1) {
          // We found a good speaker marker to split on
          endPos = bestSplitPos;
        } else {
          // If no speaker marker found, try to split on a sentence boundary
          const lastPeriodPos = cleanedScript.lastIndexOf(".", searchWindowEnd);
          const lastQuestionPos = cleanedScript.lastIndexOf("?", searchWindowEnd);
          const lastExclamationPos = cleanedScript.lastIndexOf("!", searchWindowEnd);
          
          const sentenceEndPositions = [lastPeriodPos, lastQuestionPos, lastExclamationPos]
            .filter(pos => pos >= searchWindowStart && pos < searchWindowEnd);
          
          if (sentenceEndPositions.length > 0) {
            // Split at the last sentence boundary in our search window
            endPos = Math.max(...sentenceEndPositions) + 1; // Include the punctuation
          } else {
            // Last resort: try for a newline
            const lastNewlinePos = cleanedScript.lastIndexOf("\n", searchWindowEnd);
            if (lastNewlinePos >= searchWindowStart) {
              endPos = lastNewlinePos + 1; // Include the newline
            }
            // Otherwise just use our safe target size
          }
        }
      } else {
        // We're at the last chunk
        endPos = cleanedScript.length;
      }
      
      // Extract the chunk and verify it's not too long
      const chunk = cleanedScript.substring(currentPos, endPos);
      if (chunk.length > 4000) {
        console.warn(`Chunk ${scriptChunks.length} is too long (${chunk.length} chars). Forcing a smaller chunk.`);
        // Force a smaller chunk by using a position exactly at the target size
        endPos = currentPos + 3500;
      }
      
      scriptChunks.push(cleanedScript.substring(currentPos, endPos));
      currentPos = endPos;
    }

    console.log(`Split podcast script into ${scriptChunks.length} chunks`)

    // Update the job with the actual number of chunks
    await supabaseClient
      .from('podcast_jobs')
      .update({
        total_chunks: scriptChunks.length
      })
      .eq('id', jobId)

    // Insert each chunk into the podcast_chunks table
    for (let i = 0; i < scriptChunks.length; i++) {
      const chunkText = scriptChunks[i]
      
      // Insert the chunk record
      const { data: chunkData, error: chunkError } = await supabaseClient
        .from('podcast_chunks')
        .insert({
          job_id: jobId,
          chunk_index: i,
          chunk_text: chunkText,
          status: 'pending'
        })
        .select()
        .single()

      if (chunkError) {
        console.error(`Error creating podcast chunk ${i}:`, chunkError)
        // Don't throw here, continue with other chunks
      } else {
        console.log(`Created podcast chunk ${i} with ID: ${chunkData.id}`)
      }
    }

    // Process the first chunk immediately
    if (scriptChunks.length > 0) {
      // Instead of processing the first chunk inline, we'll call the process-next-chunk
      // function for it, just like we do for subsequent chunks. This helps avoid timeouts
      // in this primary function.
      const nextChunkUrl = `${supabaseUrl}/functions/v1/process-next-chunk`
      
      // Call the next chunk processing endpoint for the first chunk
      try {
        await fetch(nextChunkUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({
            jobId: jobId,
            nextChunkIndex: 0
          })
        })
        console.log("Successfully triggered processing for first chunk")
      } catch (error) {
        console.error("Error triggering first chunk processing:", error)
        // Continue anyway - the status check will retry
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Started processing podcast audio in ${scriptChunks.length} chunks`,
        jobId: jobId
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error("Error in process-podcast-audio function:", error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}) 