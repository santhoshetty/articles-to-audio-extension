import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"

serve(async (req) => {
  try {
    // Log request received
    console.log("Generate summary function called")
    
    // Get the article text from the request body
    const { text } = await req.json()
    
    if (!text) {
      console.error("No text provided in request")
      throw new Error("Article text is required")
    }

    console.log("Text length:", text.length, "characters")

    // Initialize OpenAI with the API key from edge function secrets
    const apiKey = Deno.env.get('openai_api_key')
    if (!apiKey) {
      console.error("OpenAI API key not found in environment")
      throw new Error("OpenAI API key not configured")
    }

    const openai = new OpenAI({ apiKey })

    // Generate summary using OpenAI
    console.log("Calling OpenAI API...")
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Summarize the following article concisely while maintaining key details, \
          covering the main topic, essential facts, important arguments, and any conclusions. \
          Highlight the who, what, when, where, why, and how (if applicable). Retain the \
          original tone—whether informative, analytical, or opinion-based—and include any \
          significant statistics, quotes, or expert opinions mentioned. Ensure clarity, \
          coherence, and neutrality (unless it is an opinion piece, in which case, reflect \
          the stance of the author accurately). If there are action points or takeaways, include \
          them in bullet points.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    })

    const summary = response.choices[0].message.content.trim()
    console.log("Summary generated successfully, length:", summary.length, "characters")

    // Return the generated summary
    return new Response(
      JSON.stringify({ 
        summary,
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
    console.error('Error in generate-summary function:', {
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