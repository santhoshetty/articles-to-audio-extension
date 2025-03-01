Below is a Product Requirements Document (PRD) that captures your specifications and proposed changes:

---

# Product Requirements Document (PRD)

## Product Overview
**Product Name:** Article-to-Audio Extension  
**Description:** An extension that converts user-selected articles into a seamless podcast. It leverages OpenAI for generating podcast scripts and text-to-speech conversions, with Supabase handling backend storage and job tracking via edge functions.

## Problem Statement
Currently, articles are processed in chunks of 2. When users select 5–6 articles for podcast generation, the primary generate-podcast edge function times out (resulting in a 504 error). This limitation prevents scaling the service for multi-article podcasts and disrupts the user experience.

## Goals & Objectives
- **Scalability:** Enable podcast generation from multiple articles (beyond two) without timing out.
- **Seamless Experience:** Produce a continuous and natural-sounding podcast with smooth transitions between articles.
- **Efficiency:** Optimize processing by breaking down intensive tasks into manageable, asynchronous steps.
- **Reliability:** Ensure proper tracking and error handling so that each stage of the process completes successfully.

## Proposed Solution

### 1. Podcast Script Generation
- **Separate Edge Function:** Create a dedicated edge function for generating the entire podcast script.
- **Script Structure:**  
  - **Introduction:** 
    - Must introduce at least the titles of all selected articles.
  - **Body:** 
    - Each article is processed individually.
    - The script for each article should be generated via separate API calls if needed.
  - **Conclusion:** 
    - Must reference and seamlessly consider the content of all articles.
- **Podcast Length Calculation:**  
  - Overall podcast length will be computed as:  
    **(4 minutes × number of articles) + 2 minutes** (for intro, conclusion, and extras).

### 2. Audio Generation for Podcast Script
- **Chunking the Script:**  
  - The generated podcast script must be divided into smaller chunks due to the intensive nature of audio generation and the 50 s max run time for an edge function.
  - The system should determine the optimal chunk size based on time segments, ensuring each chunk can be processed within the 50-second limit.
- **Edge Function per Chunk:**  
  - For each chunk, call a separate edge function responsible for:
    - Converting text to audio using a text-to-speech API.
    - Saving intermediate audio outputs.
- **Job Tracking & Storage:**  
  - Use Supabase service role key to write intermediate audio files to storage.
  - Implement a job tracking table that logs the completion status of each chunk.
  - The job tracking system should record which chunks have been processed, their status, and any error information.
  - Implement triggers to initiate the next chunk processing once the current job is completed.
  - If any chunk fails to process, the entire job should fail rather than producing incomplete podcasts.

### 3. Combining Audio Chunks
- **Final Assembly:**  
  - Once all individual audio chunks are generated, invoke a dedicated edge function to combine them into one final audio file.
- **Seamless Audio Output:**  
  - The final podcast must feel continuous with no abrupt transitions between the different article segments.
- **Storage:**  
  - Save the combined audio file in Supabase storage as the final podcast output.
  - Final audio format should be MP3.

## Technical Requirements

### Backend & Infrastructure
- **Supabase:**  
  - Use for storage, job tracking, and secure API key management (service role key).
  - Extend existing tables or create new job tracking tables depending on what provides better debugging capabilities.
- **Edge Functions:**  
  - Create three distinct types:
    1. Script Generation
    2. Audio Generation (chunked processing)
    3. Audio Combination

### API Integration
- **OpenAI API:**  
  - For generating the podcast script.
- **Text-to-Speech API:**  
  - For converting script chunks into audio.
- **Supabase MCP server**
  - Supabase MCP Server has been set up. Agent should make use of this tool.

### Performance & Scalability
- **Execution Time:**  
  - Ensure each edge function call does not exceed the 50 s run time limit.
- **Chunking Strategy:**  
  - Divide large podcast scripts into smaller, manageable parts to avoid timeouts.
  - The system should determine the optimal chunk size that can be processed within time limits.

### Error Handling & Job Tracking
- **Timeout & Error Management:**  
  - Implement error handling for timeouts (e.g., 504 errors) and retries where appropriate.
  - If one chunk fails to process, the entire job should fail (no partial podcasts).
- **Job Status Table:**  
  - Track progress for each chunk and trigger subsequent jobs only when previous chunks are successfully processed.

### User Experience
- **Progress Indication:**
  - Users should be notified of job progress via a percentage bar on the articles.html frontend.
  - The frontend should update as chunks are processed to show overall progress.

## Acceptance Criteria
- **Script Generation:**  
  - The podcast script includes a unified introduction (listing all article titles), individual article segments, and a concluding section that seamlessly references all articles.
- **Audio Generation:**  
  - The script is successfully broken into chunks and processed within the time constraints of edge functions.
  - All intermediate audio outputs are saved correctly and tracked.
- **Audio Combination:**  
  - The final podcast audio is seamlessly combined with no abrupt transitions.
  - The final audio file is stored in Supabase as an MP3.
- **Scalability:**  
  - The system can handle the processing of 5 or more articles without timing out.
- **Reliability:**  
  - Job tracking correctly reflects the status of each audio chunk generation and triggers subsequent processing steps reliably.

## Dependencies & Risks
- **API Rate Limits & Timeouts:**  
  - Ensure the system gracefully handles rate limits and potential API timeouts.
- **Edge Function Limitations:**  
  - Mitigate risks related to the 50 s run time constraint of Supabase edge functions by effective chunking.
- **Service Integration:**  
  - Dependency on Supabase and third-party APIs requires robust error handling and fallbacks.
- **User Experience:**  
  - The final output must maintain a natural flow to avoid a disjointed podcast experience.


---

This PRD should serve as a clear guide for your development team to implement the proposed enhancements, ensuring the generated podcasts are seamless and scalable even when multiple articles are selected.