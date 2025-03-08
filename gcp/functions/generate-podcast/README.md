# Podcast Generator Cloud Function

This GCP Cloud Function takes article content, generates a podcast script with two hosts discussing the articles, converts the script to audio using OpenAI's TTS, and stores the result in Supabase.

## Project Structure

The project has been refactored into a modular structure:

```
.
├── index.js                 # Main entry point for the Cloud Function
├── src/
│   ├── handlers/            # Request handlers
│   │   └── podcastHandler.js # Main logic for podcast generation
│   ├── services/            # Service modules
│   │   ├── audio.js         # Audio generation and processing
│   │   ├── content.js       # Script content generation
│   │   ├── database.js      # Database operations
│   │   └── secrets.js       # Secret management
│   ├── utils/               # Utility modules
│   │   ├── logging.js       # Logging utilities including trace
│   │   ├── monitoring.js    # Watchdog and progress monitoring
│   │   └── rateLimiter.js   # Rate limiting for API calls
│   └── config/              # Configuration (not used yet)
└── test.js                  # Test script
```

## Functionality

1. **Request Handling**: The function receives a request with article data, job ID, and user information.
2. **Script Generation**: It generates a podcast script with two hosts (Alice and Bob) discussing the articles.
3. **Audio Generation**: The script is converted to audio using OpenAI's TTS API with different voices for each host.
4. **Storage**: The audio file is stored in Supabase storage and linked to the articles in the database.

## Key Features

- **Rate Limiting**: Manages API request rates to avoid hitting OpenAI's rate limits
- **Batch Processing**: Audio generation is done in batches to optimize performance
- **Error Handling**: Robust error handling with retries and fallbacks
- **Monitoring**: Watchdog and progress tracking to detect stuck processes
- **Tracing**: Comprehensive tracing system to track execution flow and timing
- **Memory Management**: Careful memory management for handling large audio files

## API Usage

The function handler is registered in `index.js`:

```javascript
functions.http('processPodcastAudio', processPodcastAudio);
```

### Request Format

```json
{
  "articles": [
    {
      "id": "article-uuid",
      "title": "Article Title",
      "content": "Article content...",
      "summary": "Article summary (optional)"
    }
  ],
  "jobId": "job-uuid",
  "userId": "user-uuid",
  "authToken": "auth-token"
}
```

### Response

The function returns a 200 response immediately to prevent timeouts, then processes the request asynchronously.

## Development

### Local Testing

To run the function locally:

```bash
npm run start
```

### Deployment

To deploy to GCP:

```bash
npm run deploy
```

## Dependencies

- `@google-cloud/functions-framework`: Framework for Cloud Functions
- `@google-cloud/secret-manager`: For accessing secrets
- `@supabase/supabase-js`: Supabase client
- `openai`: OpenAI API client
- `axios`: HTTP client for direct API calls 