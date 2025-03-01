import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { OpenAI } from "https://esm.sh/openai@4.28.0"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

serve(async (req) => {
  try {
    // Log request received
    console.log("Generate podcast script function called")
    
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

    // Calculate podcast length based on PRD formula
    // (4 minutes × number of articles) + 2 minutes
    const podcastLengthMinutes = (4 * articles.length) + 2
    
    console.log(`Calculated podcast length: ${podcastLengthMinutes} minutes for ${articles.length} articles`)

    // Get all article titles for the introduction
    const allArticleTitles = articles.map(article => article.title)
    
    // Common templates for podcast sections
    const toneStyleTemplate = `Tone and Style:
  - Conversational and engaging, as if speaking directly to the listener.
  - Use inclusive language to foster a sense of community.
  - Incorporate light humor or personal anecdotes where appropriate to humanize the discussion.`;

    const guidelinesTemplate = `Additional Guidelines:
  - Ensure a balanced exchange between both hosts, allowing each to contribute equally.
  - Use clear and concise language, avoiding jargon unless it's explained.
  - Aim for smooth transitions between topics to maintain listener interest.
  - IMPORTANT: DO NOT use terms like "Segment 1" or "Section 2" in the actual dialogue.
  - Consider the use of rhetorical questions to engage the audience and provoke thought.
  - ALWAYS refer to the hosts by their actual names (Alice and Bob), not as "Host 1" or "Host 2".`;

    const formatTemplate = `Format it like a real dialogue:
Alice: ...
Bob: ...
Alice: ...
Bob: ...
Continue this structure with natural conversation flow.`;

    console.log("Generating podcast script in parts...")
    
    // Step 1: Generate the introduction
    console.log("Generating introduction...")
    const introPrompt = `You are two podcast hosts, Alice and Bob.

Create the INTRODUCTION ONLY (about 1 minute) for a podcast where you will discuss the following articles:
${allArticleTitles.map((title, i) => `${i + 1}. ${title}`).join('\n')}

The introduction should:
- Alice greets listeners and introduces Bob.
- Brief overview of the episode's topic and its relevance.
- Mention ALL of these topics you'll be discussing: ${allArticleTitles.join(', ')}
- Create excitement about the full range of articles being covered in this episode.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}

IMPORTANT: Only write the introduction section. Do not continue to discuss the articles yet.`

    const introResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-16k',
      messages: [{ role: 'system', content: introPrompt }],
      max_tokens: 1000,
      temperature: 0.7
    })
    
    const introScript = introResponse.choices[0].message.content.trim()
    console.log("Introduction generated successfully")

    // Step 2: Generate individual article segments
    console.log("Generating article segments...")
    const articleSegments = []

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      console.log(`Processing article ${i + 1}: ${article.title}`)
      
      const articlePrompt = `You are two podcast hosts, Alice and Bob.

Create a section of a podcast script discussing ONLY this article (about 4 minutes worth of content):
Title: ${article.title}
Content: ${article.summary || article.content}

For this article segment, cover these aspects in a natural conversation:
- Starting the article segment:
  - Only say "Let's discuss the article: ${article.title}." No need to say welcome back to podcast etc.
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
  - Discuss potential innovations or changes on the horizon.
- Ending the article segment:
  - Only say "That's all for this article." No need to say don't forget to subscribe to the podcast etc.

${toneStyleTemplate}

${guidelinesTemplate}
- For article transitions: If this is not the first article (${i > 0 ? 'this is NOT the first article' : 'this IS the first article'}), start with a smooth transition from the previous topic.
- If this is not the last article (${i < articles.length - 1 ? 'this is NOT the last article' : 'this IS the last article'}), end with a transition to the next topic.

${formatTemplate}

IMPORTANT: Focus ONLY on this article. Do not introduce or conclude the entire podcast. Just create a natural segment for this specific article.`

      const articleResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-16k',
        messages: [{ role: 'system', content: articlePrompt }],
        max_tokens: 2500,
        temperature: 0.7
      })
      
      const articleScript = articleResponse.choices[0].message.content.trim()
      articleSegments.push(articleScript)
      console.log(`Article ${i + 1} segment generated successfully`)
    }

    // Step 3: Generate the conclusion
    console.log("Generating conclusion...")
    const conclusionPrompt = `You are two podcast hosts, Alice and Bob.

Create the CONCLUSION ONLY (about 1 minute) for a podcast where you discussed these articles:
${allArticleTitles.map((title, i) => `${i + 1}. ${title}`).join('\n')}

The conclusion should:
- Hosts summarize key takeaways from ALL the articles discussed.
- Reference all the topics covered to create a cohesive conclusion.
- Encourage listeners to reflect on the topics or engage further.
- Thank the audience for listening and mention potential future episodes.

${toneStyleTemplate}

${guidelinesTemplate}

${formatTemplate}

IMPORTANT: Only write the conclusion section. Assume you've already discussed all the articles in detail.`

    const conclusionResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo-16k',
      messages: [{ role: 'system', content: conclusionPrompt }],
      max_tokens: 1000,
      temperature: 0.7
    })
    
    const conclusionScript = conclusionResponse.choices[0].message.content.trim()
    console.log("Conclusion generated successfully")

    // Step 4: Combine all segments into a seamless podcast script
    const fullPodcastScript = [
      introScript,
      ...articleSegments,
      conclusionScript
    ].join('\n\n')

    console.log("All script segments combined successfully")

    // Generate a unique ID for the script file
    const scriptId = crypto.randomUUID()
    
    // Return success response with the script and podcast length
    return new Response(
      JSON.stringify({ 
        script_id: scriptId,
        podcast_script: fullPodcastScript,
        podcast_length_minutes: podcastLengthMinutes,
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
    console.error('Error in generate-podcast-script function:', {
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