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
    const prompt = `You are two podcast hosts, Alice and Bob.
    Discuss the following articles in a conversational and engaging way.
    
    ${articles.map((article, i) => `Article ${i + 1}: ${article.title}
    ${article.summary || article.content.substring(0, 500)}`).join('\n\n')}
    
    Format it like a real dialogue:
    Host 1: (Introduction)
    Host 2: (Comment)
    Host 1: (More details)
    Host 2: (Opinion)
    Continue this structure.`

    const scriptResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: prompt
        }
      ],
      max_tokens: 1500,
      temperature: 0.7
    })

    const script = scriptResponse.choices[0].message.content.trim()
    console.log("Conversation script generated")

    // Parse script into lines for each speaker
    const lines = script.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.trim())

    // Generate audio for each line in order, alternating voices
    console.log("Generating audio for speakers...")
    const audioPromises = []

    for (const line of lines) {
      const cleanedLine = line.replace(/^(Host ?[12]:?\s*)/i, '').trim()
      // Determine if this is Host 1 or Host 2
      const isHost1 = line.match(/^Host ?1:?/i)
      
      const response = await openai.audio.speech.create({
        model: "tts-1",
        voice: isHost1 ? "alloy" : "onyx",
        input: cleanedLine
      })
      const buffer = await response.arrayBuffer()
      audioPromises.push(buffer)
    }

    // Combine all audio buffers
    const totalLength = audioPromises.reduce((acc, buf) => acc + buf.byteLength, 0)
    const combinedBuffer = new Uint8Array(totalLength)
    let offset = 0
    for (const buffer of audioPromises) {
      combinedBuffer.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
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