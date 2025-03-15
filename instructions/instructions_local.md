# Article to Audio Chrome Extension: Local Version PRD

## Product Overview
The Article to Audio Chrome Extension (Local Version) allows users to save web articles and convert them into audio podcasts without relying on any external storage or cloud services (except for OpenAI API for content generation). All articles and audio files are stored locally in the user's browser, providing enhanced privacy and offline capabilities.

## Target Users
- Privacy-conscious individuals who prefer local storage over cloud storage
- Users with unreliable internet connections who need offline access to their saved content
- Individuals who want to control their own data
- People who want to convert articles to audio without subscribing to cloud services

- COPY all functionality from gcp functions and from codebase as required.

## Core Features

### 1. Article Management
- **Article Capture**: Extract article content from web pages
- **Local Storage**: Save articles to IndexedDB in the browser
- **Article Organization**: List, filter, and search saved articles
- **Article Deletion**: Remove articles from local storage
- **Export/Import**: Allow users to export their article library and import it on another device

### 2. Audio Generation
- **Text-to-Speech Conversion**: Generate audio from article text using OpenAI's API
- **Local Audio Storage**: Store generated audio files in IndexedDB
- **Audio Playback**: Play audio files directly in the browser
- **Audio Download**: Save audio files to the user's device

### 3. Content Enhancement
- **Summary Generation**: Create article summaries using OpenAI's API
- **Title Generation**: Generate engaging podcast titles using OpenAI's API
- **Conversation Script Generation**: Convert articles into engaging podcast scripts with multiple voices using OpenAI's API

### 4. User Settings
- **OpenAI API Key Management**: Allow users to securely store their OpenAI API key
- **Voice Selection**: Choose preferred voices for the podcast
- **Audio Format Controls**: Adjust quality, format, and other audio settings
- **Data Management**: Tools to manage local storage usage and clear data

## Technical Requirements

### 1. Local Storage Implementation
- Use IndexedDB for storing articles, summaries, and audio files
- Implement efficient binary storage for audio data
- Create a local database schema that supports:
  - Article storage (title, content, URL, date, etc.)
  - Audio file storage (blob data, metadata)
  - Relationship mapping between articles and audio files

### 2. API Integration
- Securely store and manage OpenAI API keys
- Implement API call functionality for:
  - Text summarization
  - Podcast script generation
  - Text-to-speech conversion
  - Title generation
- Add rate limiting protection to prevent accidental excessive API usage

### 3. User Interface Enhancements
- Add settings page for OpenAI API key configuration
- Create storage management tools in the UI
- Implement offline indicators and functionality
- Add export/import interface for data portability

### 4. Background Processing
- Implement a service worker for handling:
  - Long-running audio generation processes
  - Data synchronization between browser tabs
  - Caching and offline functionality

## User Flow

### Initial Setup
1. User installs the extension
2. User opens the extension settings and enters their OpenAI API key
3. Extension validates the API key and saves it locally

### Article Capture Flow
1. User browses to an article they want to save
2. User clicks the extension icon and selects "Save Article"
3. Extension extracts article content and saves it to local storage
4. A confirmation message appears showing the article was saved

### Audio Generation Flow
1. User opens the "Articles" page via the extension
2. User selects one or more articles and clicks "Generate Podcast"
3. Extension displays generation options (voices, format, etc.)
4. User confirms and the extension begins generation:
   - Generates summary via OpenAI API
   - Creates podcast script via OpenAI API
   - Converts text to audio via OpenAI API
   - Stores all results locally
5. Extension notifies when the podcast is ready
6. User can play, download, or delete the podcast

## Data Privacy Considerations

### Local Data Storage
- All article content stored only in IndexedDB
- All audio files stored only in IndexedDB
- No data transmitted except to OpenAI API for generation
- Clear documentation on what data is stored and where

### API Security
- OpenAI API key stored securely in Chrome's encrypted storage
- API calls made directly from the extension, not through any intermediary server
- Minimal data sent to OpenAI (only text needed for generation)

## Performance Considerations
- Implement progressive loading for the articles list
- Add compression for stored audio files to reduce storage usage
- Implement background processing for long-running tasks
- Add storage quota management to prevent excessive browser storage use

## Future Enhancements
- Offline content extraction for saving articles without an internet connection
- Multiple voice selection for podcast generation
- Custom templates for podcast formats
- Integration with other open-source TTS engines for fully offline operation
- Batch export/import functionality
- Reading progress tracking

## Implementation Timeline
1. **Phase 1: Core Functionality**
   - Local storage implementation
   - Basic article extraction
   - OpenAI API integration for audio generation
   - Settings page for API key management

2. **Phase 2: Enhanced Features**
   - Improved article extraction and formatting
   - Advanced podcast generation options
   - Storage management tools
   - Export/import functionality

3. **Phase 3: Performance Optimization**
   - IndexedDB query optimization
   - Audio compression implementation
   - UI/UX improvements
   - Background processing enhancements

## Success Metrics
- Number of articles successfully stored locally
- Number of audio files generated
- Storage efficiency (size of audio files vs. quality)
- User engagement with saved articles and generated audio
- Extension performance metrics (load time, processing time)
