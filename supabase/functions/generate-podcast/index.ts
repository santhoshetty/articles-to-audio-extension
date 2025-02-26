import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Log request received
    console.log("Generate podcast function called")
    
    // Get the articles from the request body
    const { articles } = await req.json()
    console.log("Received articles:", JSON.stringify(articles, null, 2))
    
    if (!articles || !Array.isArray(articles)) {
      console.error("Invalid articles format:", articles)
      throw new Error("Articles must be an array")
    }

    if (articles.length === 0) {
      console.error("Empty articles array")
      throw new Error("At least one article is required")
    }

    // Validate article structure
    articles.forEach((article, index) => {
      if (!article.id) {
        throw new Error(`Article at index ${index} is missing an id`)
      }
      if (!article.title) {
        throw new Error(`Article at index ${index} is missing a title`)
      }
      if (!article.content && !article.summary) {
        throw new Error(`Article at index ${index} is missing both content and summary`)
      }
    })

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
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing Supabase configuration")
      throw new Error("Supabase configuration is incomplete")
    }

    // Log incoming headers for debugging
    const authHeader = req.headers.get('Authorization')
    console.log('Incoming headers:', {
      authorization: authHeader ? `${authHeader.substring(0, 20)}...` : 'No Bearer token',
      contentType: req.headers.get('Content-Type'),
      allHeaders: Object.fromEntries([...req.headers.entries()])
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

    // Generate conversation script
    console.log("Generating conversation script...")

    // Split articles into chunks of maximum 2 articles per chunk
    const chunkSize = 2;
    const articleChunks = [];
    for (let i = 0; i < articles.length; i += chunkSize) {
      articleChunks.push(articles.slice(i, i + chunkSize));
    }
    
    console.log(`Split ${articles.length} articles into ${articleChunks.length} chunks`);

    // Generate script for each chunk and then combine
    let combinedScript = "";
    let isFirstChunk = true;
    let isLastChunk = false;

    // Create reusable template sections to reduce repetition
    const mainDiscussionTemplate = (chunk_time_mins) => `2. Main Discussion (${chunk_time_mins} minutes):
  For each article, cover these aspects in a natural conversation:
  - Definition and Background:
    - Alice defines the topic and provides historical context.
    - Bob adds interesting facts or anecdotes related to the topic.
  - Current Relevance and Applications:
    - Both hosts discuss how the topic applies in today's world.
    - Include real-world examples, case studies, or recent news.
  - Challenges and Controversies:
    - Hosts explore any debates or challenges associated with the topic.
    - Present multiple viewpoints to provide a balanced perspective.
  - Future Outlook:
    - Hosts speculate on the future developments related to the topic.
    - Discuss potential innovations or changes on the horizon.`;

    const toneStyleTemplate = `Tone and Style:
  - Conversational and engaging, as if speaking directly to the listener.
  - Use inclusive language to foster a sense of community.
  - Incorporate light humor or personal anecdotes where appropriate to humanize the discussion.`;

    const guidelinesTemplate = (includeEnding = false) => `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (Alice and Bob), not as "Host 1" or "Host 2".${includeEnding ? "\n  - END the script in a way that naturally leads to more discussion (DO NOT conclude the podcast)." : ""}`;

    const formatTemplate = `Format it like a real dialogue:
Alice: ...
Bob: ...
Alice: ...
Bob: ...
Continue this structure with natural conversation flow.`;

    const transitionTemplate = `IMPORTANT TRANSITION NOTES:
  - NEVER end any chunk (except the last) with "thank you for listening", "that's all for today", or any other conclusion-like language.
  - The conversation should flow as if it will naturally continue to the next topic.
  - Do not make any reference to "wrapping up" or "concluding" except in the very last chunk.
  - Each chunk should end with a natural segue that leads into more discussion.`;

    // Get all article titles for the introduction
    const allArticleTitles = articles.map(article => article.title);
    
    for (let chunkIndex = 0; chunkIndex < articleChunks.length; chunkIndex++) {
      const chunk = articleChunks[chunkIndex];
      isLastChunk = chunkIndex === articleChunks.length - 1;
      
      console.log(`Generating script for chunk ${chunkIndex + 1} of ${articleChunks.length} (${chunk.length} articles)`);
      
      // Calculate time for this chunk
      const chunk_time_mins = chunk.length * 5;  // 5 minutes per article
      
      // Create prompt based on chunk position (first, middle, last)
      let chunkPrompt = "";
      
      if (isFirstChunk) {
        // First chunk includes introduction to ALL articles, not just current chunk
        chunkPrompt = `You are two podcast hosts, Alice and Bob.

Create a podcast script where two hosts engage in a dynamic 
and informative conversation about the articles given below. The discussion should be accessible 
to a general audience, providing clear explanations, real-world examples, 
and diverse perspectives. Some articles have summaries as well attached.

${chunk.map((article, i) => `Article ${i + 1}: ${article.title}
${article.summary || article.content}`).join('\n\n')}

Structure:

1. Introduction (1 minute):
  - Alice greets listeners and introduces Bob.
  - Brief overview of the episode's topic and its relevance.
  - Mention that today you'll be discussing ALL of these topics: ${allArticleTitles.join(', ')}
  - Create excitement about the full range of articles being covered in this episode.

${mainDiscussionTemplate(chunk_time_mins)}
${isLastChunk ? `\n3. Conclusion (1 minute):
  - Hosts summarize key takeaways from the discussion.
  - Encourage listeners to reflect on the topic or engage further.` : ''}

${toneStyleTemplate}

${guidelinesTemplate(!isLastChunk)}

${transitionTemplate}

${formatTemplate}`;
      } else if (isLastChunk) {
        // Last chunk includes conclusion
        chunkPrompt = `You are two podcast hosts, Alice and Bob, continuing an ongoing conversation.

Create a natural continuation of a podcast discussion about the following articles.
You've already discussed other topics earlier in the podcast, and now you'll discuss these final articles.
The discussion should be accessible to a general audience, providing clear explanations, real-world examples, 
and diverse perspectives. Some articles have summaries as well attached.

${chunk.map((article, i) => `Article ${articleChunks.flat().indexOf(article) + 1}: ${article.title}
${article.summary || article.content}`).join('\n\n')}

Structure for this part:

1. Transition (briefly acknowledge you're moving to new articles, but make it sound completely natural)

${mainDiscussionTemplate(chunk_time_mins)}

3. Conclusion (1 minute):
  - Hosts summarize key takeaways from ALL articles discussed (including those from earlier parts).
  - Encourage listeners to reflect on the topics or engage further.
  - Thank the audience for listening and mention any future episodes.

${toneStyleTemplate}

${guidelinesTemplate()}
  - Make this sound like a SEAMLESS CONTINUATION of an ongoing conversation (don't explicitly reference "continuing our discussion").
  - ONLY in this final chunk should you include a proper podcast conclusion.

${formatTemplate}`;
      } else {
        // Middle chunk
        chunkPrompt = `You are two podcast hosts, Alice and Bob, continuing an ongoing conversation.

Create a natural continuation of a podcast discussion about the following articles.
You've already discussed other topics earlier in the podcast, and will discuss more after this section.
The discussion should be accessible to a general audience, providing clear explanations, real-world examples, 
and diverse perspectives. Some articles have summaries as well attached.

${chunk.map((article, i) => `Article ${articleChunks.flat().indexOf(article) + 1}: ${article.title}
${article.summary || article.content}`).join('\n\n')}

Structure for this part:

1. Transition (briefly acknowledge you're moving to new articles, but make it sound completely natural)

${mainDiscussionTemplate(chunk_time_mins)}

${toneStyleTemplate}

${guidelinesTemplate(true)}
  - Make this sound like a SEAMLESS CONTINUATION of an ongoing conversation (don't explicitly reference "continuing our discussion").

${transitionTemplate}

${formatTemplate}`;
      }
      
      // Generate script for this chunk
      const chunkScriptResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: chunkPrompt
          }
        ],
        max_tokens: 4096,
        temperature: 0.7
      });
      
      const chunkScript = chunkScriptResponse.choices[0].message.content.trim();
      
      // Add to combined script
      if (combinedScript) {
        // Add a newline between chunks
        combinedScript += "\n\n" + chunkScript;
      } else {
        combinedScript = chunkScript;
      }
      
      isFirstChunk = false;
    }
    
    console.log("Combined script generated from multiple chunks");
    
    const script = combinedScript;

    // Parse script into lines for each speaker
    const lines = script.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim())
      .filter(line => line.match(/^(Alice|Bob):?/i)) // Only keep lines with Alice or Bob prefixes

    // Generate audio for each line in order, with proper voice assignment
    console.log("Generating audio for speakers...")
    const audioPromises = []
    const audioMetadata = [] // Keep track of which voice was used for each segment

    for (const line of lines) {
      const cleanedLine = line.replace(/^(Alice|Bob):?\s*/i, '').trim()
      // Determine if this is Alice or Bob
      const isAlice = line.match(/^Alice:?/i)
      const voice = isAlice ? "alloy" : "onyx"
      
      console.log(`Generating audio for: "${cleanedLine.substring(0, 50)}..." with voice: ${voice}`)
      
      try {
        const response = await openai.audio.speech.create({
          model: "tts-1",
          voice: voice,
          input: cleanedLine
        })
        const buffer = await response.arrayBuffer()
        audioPromises.push(buffer)
        audioMetadata.push({ isAlice, voice })
      } catch (error) {
        console.error(`Error generating audio for line: "${cleanedLine.substring(0, 50)}..."`, error)
        // Continue with other lines even if one fails
      }
    }

    console.log(`Generated ${audioPromises.length} audio segments with alternating voices`)

    // Combine all audio buffers with proper spacing between speakers
    const totalLength = audioPromises.reduce((acc, buf) => acc + buf.byteLength, 0)
    const combinedBuffer = new Uint8Array(totalLength)
    let offset = 0
    for (let i = 0; i < audioPromises.length; i++) {
      const buffer = audioPromises[i]
      combinedBuffer.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
      
      // Log which speaker and voice was used
      console.log(`Added segment ${i+1}: ${audioMetadata[i].isAlice ? 'Alice (alloy)' : 'Bob (onyx)'}, Length: ${buffer.byteLength} bytes`)
    }

    // Generate a unique ID for the audio file
    const filenameID = crypto.randomUUID()
    const fileName = `public/${filenameID}.mp3`


    // Log upload attempt details
    console.log('Attempting file upload:', {
      fileName,
      bucket: 'audio-files',
      contentType: 'audio/mp3',
      bufferSize: combinedBuffer.byteLength
    })

    // Function to attempt upload with retry
    const attemptUpload = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          // Upload the combined audio to Supabase storage
          console.log(`Upload attempt ${i + 1} of ${retries}...`)
          const { data, error } = await supabaseClient.storage
            .from('audio-files')
            .upload(fileName, combinedBuffer, {
              contentType: 'audio/mp3',
              duplex: 'half',
              upsert: false
            })

          if (error) {
            console.error(`Upload attempt ${i + 1} failed:`, {
              message: error.message,
              details: error.details,
              status: error.status,
              fileName,
              attempt: i + 1
            })
            if (i === retries - 1) throw error
          } else {
            console.log('Upload successful:', data)
            return data
          }
        } catch (err) {
          if (i === retries - 1) throw err
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
        }
      }
    }

    // Attempt upload with retry logic
    try {
      await attemptUpload()
    } catch (uploadError) {
      console.error('All upload attempts failed:', {
        message: uploadError.message,
        details: uploadError.details,
        status: uploadError.status,
        fileName
      })
      throw uploadError
    }

    // Get the public URL for the uploaded file
    const { data: { publicUrl } } = supabaseClient.storage
      .from('audio-files')
      .getPublicUrl(fileName)


    console.log("Authenticated User ID:", userId);

    // Create entry in audio_files table
    const audioFileData = {
      file_url: publicUrl,
      created_at: new Date().toISOString(),
      user_id: userId
    };

    console.log("Attempting to insert audio file entry:", audioFileData);

    const { data: audioFile, error: audioFileError } = await supabaseClient
      .from('audio_files')
      .insert(audioFileData)
      .select()
      .single();

    if (audioFileError) {
      console.error('Error inserting audio file entry:', {
        message: audioFileError.message,
        details: audioFileError.details,
        hint: audioFileError.hint,
        status: audioFileError.status
      });
      throw audioFileError;
    }

    console.log("Successfully inserted audio file entry");

    // Create entries in article_audio table
    const articleAudioEntries = articles.map(article => ({
      article_id: article.id,
      audio_id: audioFile.id,
      user_id: userId
    }))

    console.log("Attempting to insert article audio map entries: ", articleAudioEntries);

    const { error: articleAudioError } = await supabaseClient
      .from('article_audio')
      .insert(articleAudioEntries)

    if (articleAudioError) {
      console.error('Error inserting article audio map entries:', {
        message: articleAudioError.message,
        details: articleAudioError.details,
        hint: articleAudioError.hint,
        status: articleAudioError.status
      });
      throw articleAudioError;
    }

    console.log("Successfully inserted article audio map entries");

    // Return success response
    return new Response(
      JSON.stringify({ 
        audio_file_id: audioFile.id,
        audio_url: publicUrl,
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
    )
  } catch (error) {
    // Enhanced error logging
    console.error('Error in generate-podcast function:', {
      message: error.message,
      stack: error.stack,
      cause: error.cause
    })

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
    )
  }
}) 