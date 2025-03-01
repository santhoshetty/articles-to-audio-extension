import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Log request received
    console.log("Process next chunk function called")
    
    // Get the job ID and next chunk index from the request body
    const { jobId, nextChunkIndex } = await req.json()
    
    if (!jobId) {
      console.error("Missing job ID")
      throw new Error("Job ID is required")
    }

    if (nextChunkIndex === undefined) {
      console.error("Missing next chunk index")
      throw new Error("Next chunk index is required")
    }

    // Initialize OpenAI with the API key from edge function secrets
    const apiKey = Deno.env.get('openai_api_key')
    if (!apiKey) {
      console.error("OpenAI API key not found in environment")
      throw new Error("OpenAI API key not configured")
    }

    const openai = new OpenAI({ apiKey })

    // Get Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration")
      throw new Error("Supabase configuration is incomplete")
    }

    // Use service role for this function since it's called from another edge function
    const supabaseAdmin = createClient(
      supabaseUrl,
      supabaseServiceKey
    )

    // Get the chunk text and job info
    const { data: chunkData, error: chunkError } = await supabaseAdmin
      .from('podcast_chunks')
      .select('chunk_text, job_id')
      .eq('job_id', jobId)
      .eq('chunk_index', nextChunkIndex)
      .single()

    if (chunkError || !chunkData) {
      console.error(`Error fetching chunk ${nextChunkIndex}:`, chunkError)
      throw new Error(`Failed to get chunk data: ${chunkError?.message || "Chunk not found"}`)
    }

    // Get user ID from the job
    const { data: jobData, error: jobError } = await supabaseAdmin
      .from('podcast_jobs')
      .select('user_id')
      .eq('id', jobId)
      .single()

    if (jobError || !jobData) {
      console.error("Error fetching job:", jobError)
      throw new Error(`Failed to get job data: ${jobError?.message || "Job not found"}`)
    }

    const userId = jobData.user_id

    // Update chunk status to processing
    await supabaseAdmin
      .from('podcast_chunks')
      .update({
        status: 'processing'
      })
      .eq('job_id', jobId)
      .eq('chunk_index', nextChunkIndex)

    console.log(`Processing chunk ${nextChunkIndex} for job ${jobId}...`)

    try {
      // Clean the input text - ensure newlines are properly handled
      const cleanedText = chunkData.chunk_text.replace(/\\n/g, "\n").trim()
      
      // Split the cleaned text into speaker segments
      const segments = []
      const lines = cleanedText.split('\n')
      
      let currentSpeaker = null
      let currentSegment = ""
      
      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue
        
        // Check if this is a new speaker
        const aliceMatch = trimmedLine.match(/^Alice:/)
        const bobMatch = trimmedLine.match(/^Bob:/)
        
        if (aliceMatch || bobMatch) {
          // If we have a previous segment, push it
          if (currentSegment && currentSpeaker) {
            segments.push({
              text: currentSegment.trim(),
              speaker: currentSpeaker
            })
          }
          
          // Start a new segment
          currentSpeaker = aliceMatch ? "Alice" : "Bob"
          currentSegment = trimmedLine
        } else if (currentSpeaker) {
          // Continue current segment
          currentSegment += " " + trimmedLine
        }
      }
      
      // Add the last segment if exists
      if (currentSegment && currentSpeaker) {
        segments.push({
          text: currentSegment.trim(),
          speaker: currentSpeaker
        })
      }
      
      console.log(`Split chunk ${nextChunkIndex} into ${segments.length} speaker segments`)
      
      // Generate audio for each segment
      const audioBuffers = []
      const audioMetadata = [] // Keep track of which voice was used for each segment
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        // Clean the segment text by removing the speaker prefix
        const cleanedSegmentText = segment.text.replace(/^(Alice|Bob):\s*/i, "").trim()
        
        if (cleanedSegmentText.length === 0) continue
        
        // Check if segment is within TTS limit
        if (cleanedSegmentText.length > 4000) {
          console.warn(`Segment ${i} for speaker ${segment.speaker} exceeds 4000 characters (${cleanedSegmentText.length}), truncating`)
          // Truncate to stay under limits
          segment.text = cleanedSegmentText.substring(0, 3900) + "..."
        }
        
        // Select the appropriate voice based on speaker
        const voice = segment.speaker === "Alice" ? "alloy" : "onyx"
        
        console.log(`Generating audio for ${segment.speaker} segment ${i} with voice ${voice} (${cleanedSegmentText.length} chars)`)
        
        // Implement retry logic for audio generation
        let retryCount = 0
        const maxRetries = 2
        let success = false
        let error = null
        
        while (!success && retryCount <= maxRetries) {
          try {
            if (retryCount > 0) {
              console.log(`Retry ${retryCount}/${maxRetries} for segment ${i}`)
            }
