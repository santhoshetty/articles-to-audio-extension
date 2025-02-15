
---

# Product Requirements Document (PRD)

## 1. Overview

**Project Name:** Article-to-Podcast Platform  
**Platforms:** Chrome Extension & Mobile App (iOS/Android)  
**Backend Services:** Supabase (for metadata and cloud storage)  
**Security:** Backend Proxy for secure OpenAI API calls  

---

## 2. Background & Problem Statement

### Background
- The current Chrome extension allows users to:
  - Save articles found online.
  - Generate text summaries and audio versions of these summaries.
  - Convert selected saved articles into a podcast.
- These artifacts are stored locally (Extension Storage and IndexedDB) and rely on the user to manually enter their OpenAI API key.

### Problem Statement
- **Data Fragmentation:** Artifacts are stored locally, limiting access to a single device (Chrome browser) and complicating data synchronization.
- **User Experience:** Manual entry of the OpenAI API key creates friction and potential security risks.
- **Accessibility:** Users need access to their generated podcasts on their mobile devices, requiring a mobile application or cross-platform solution.

---

## 3. Objectives & Goals

### Primary Objectives
- **Data Centralization:**  All saved articles, summaries, and audio files will be on a cloud-based storage system using Supabase.
- **Unified Access:** Provide seamless access to data across both Chrome Extension and Mobile App.
- **Improved Security & UX:** Replace manual OpenAI API key input with a secure, user-friendly sign-on experience and backend proxy.

### Goals
- Create a unified API layer for both the extension and mobile app.
- Implement a secure backend proxy to handle API calls to OpenAI.
- Ensure a consistent, responsive user experience across all platforms.
- Facilitate offline access and synchronization where possible.

---

## 4. Scope & Features

### In Scope
- **Chrome Extension Updates:**
  - Update data flows to interact with the unified API.
  - Integrate user authentication (SSO/OAuth).
- **Mobile App Development:**
  - Develop a cross-platform mobile app (React Native or Flutter) that mirrors the core functionality of the Chrome extension.
  - Offline caching and sync capabilities.
- **Backend Services:**
  - Implement a RESTful API as a unified access point.
  - Develop a backend proxy to securely handle OpenAI API calls, hiding API keys from the client.
  - Use Supabase for metadata (article information, summaries, etc.) and for large audio files.
- **Security & Monitoring:**
  - Secure all endpoints via HTTPS.
  - Monitor API usage and errors using logging and analytics (e.g., Supabase’s built-in tools or third-party services).

### Out of Scope
- Native desktop applications outside the Chrome extension.
- Advanced offline editing capabilities beyond caching and sync.

---

## 5. User Stories

### Chrome Extension User
- **US1:** As a user, I want to save an article from my browser so that I can later generate a summary and audio version.
- **US2:** As a user, I want my saved articles and generated content to be synchronized to the cloud so that I can access them from any device.
- **US3:** As a user, I want a secure sign-in process so that I don’t need to manually manage API keys.

### Mobile App User
- **US4:** As a mobile user, I want to view my saved articles and listen to generated podcasts on my phone.
- **US5:** As a mobile user, I want offline access to my saved content, with automatic syncing when connectivity is restored.
- **US6:** As a mobile user, I want the app to provide the same core functionalities as the Chrome extension in a mobile-friendly UI.

### Backend/API Developer
- **US7:** As a developer, I want to design a unified API that handles data operations (create, read, update, delete) for articles and podcasts.
- **US8:** As a developer, I want a secure backend proxy that intercepts client requests to the OpenAI API, ensuring my API key remains confidential.

---

## 6. Technical Requirements

### Supabase Integration
- **Metadata Storage:** Use Supabase PostgreSQL to store article metadata, summary text, and audio file references.
- **Cloud Storage:** Utilize Supabase storage buckets for large files (e.g., generated audio).
- **Real-Time Sync:** Enable real-time data synchronization between the backend and client applications (where applicable).

### Backend Proxy & API Layer
- **Security:** Implement a backend proxy that receives client requests, validates user credentials, and securely calls the OpenAI API.
- **Architecture:** Build using serverless functions (e.g., Supabase Edge Functions, Vercel, AWS Lambda) or a dedicated Node.js/Express server.
- **API Design:** Provide RESTful endpoints (or GraphQL mutations/queries) for:
  - Article saving
  - Summary and audio generation requests
  - Podcast creation and retrieval
- **Authentication:** Implement OAuth/SSO or JWT-based authentication to manage user sessions and permissions.

### Mobile App Development
- **Framework:** Choose React Native or Flutter to maximize code reuse across platforms.
- **UI/UX:** Design a mobile-first UI that mirrors the functionalities of the Chrome extension while optimizing for touch interactions.
- **Offline Support:** Implement local caching (using SQLite or similar) for offline access with automatic synchronization.

### Chrome Extension Updates
- **API Integration:** Refactor the extension’s data flow to communicate with the unified API endpoints.

### Non-Functional Requirements
- **Security:** Ensure all communications are encrypted (HTTPS/TLS). Secure API endpoints and validate all inputs.
- **Performance:** Optimize the API and cloud functions for low latency. Implement caching where appropriate.
- **Scalability:** Design the backend and database schema to handle increasing numbers of users and data.
- **Reliability:** Implement monitoring, logging, and error-handling mechanisms.

---

## 7. Milestones & Timeline

1. **Phase 1: Planning & Design**
   - Finalize technical architecture and API design.
   - Design user flows and mobile UI/UX mockups.

2. **Phase 2: Backend Development**
   - Implement unified API layer and backend proxy.
   - Set up Supabase for metadata and storage.
   - Develop authentication and secure API call flows.

3. **Phase 3: Chrome Extension Update**
   - Refactor extension to use cloud API.
   - Test synchronization and authentication flows.

4. **Phase 4: Mobile App Development**
   - Develop the core mobile app features.
   - Implement offline caching and synchronization.
   - Integrate with the unified API.

5. **Phase 5: Testing & Launch**
   - Perform integration, performance, and security testing.
   - Roll out beta testing and iterate based on user feedback.
   - Official release and monitoring setup.

---

## 8. Dependencies & Risks

### Dependencies
- Availability and performance of Supabase services.
- Reliable serverless or backend hosting for API proxy.
- Third-party authentication providers (e.g., Google, GitHub) for SSO/OAuth integration.

### Risks
- **API Rate Limits:** Managing OpenAI API rate limits; mitigated by backend proxy control.
- **User Adoption:** Ensuring a smooth transition for existing users; may require in-app migration tools or clear documentation.
- **Security Concerns:** Proper handling of API keys and user credentials to prevent breaches.

---

## 9. Acceptance Criteria

- **Data Centralization:** All user data (articles, summaries, audio files) is successfully stored in Supabase and accessible from both platforms.
- **Unified API:** The API layer correctly handles all required operations (CRUD for articles, generation of summaries/audio, podcast creation) with proper security and validation.
- **Backend Proxy:** All calls to the OpenAI API are routed through a secure backend proxy, with no API keys exposed on the client side.
- **Chrome Extension & Mobile App:** Both platforms provide consistent user experiences, with real-time synchronization and offline support where applicable.
- **User Authentication:** Users can securely log in using SSO/OAuth, and no manual API key entry is required.
- **Performance & Reliability:** The system meets latency, scalability, and uptime targets as defined during performance testing.

---

This PRD serves as a blueprint for building a scalable, secure, and user-friendly Article-to-Podcast platform that integrates the Chrome extension and mobile app via a unified backend powered by Supabase and secure API interactions through a backend proxy.


Expected Project File Structure:

project-root/
├── chrome-extension/
│   ├── README.md
│   ├── manifest.json
│   ├── background.js
│   ├── background.json
│   ├── contentScript.js
│   ├── contentScript.json
│   ├── articles.html
│   ├── articles.js
│   ├── options.html
│   ├── options.js
│   ├── popup.html
│   ├── popup.js
│   ├── icons/
│   │   ├── icon128.png
│   │   ├── icon16.png
│   │   ├── icon32.png
│   │   └── icon48.png
│   └── instructions/
│       ├── instructions-to-cache.md
│       ├── instructions-to-contentScript.md
│       ├── instructions-to-hface.md
│       ├── instructions-to-podcast.md
│       └── instructions.md
│
├── backend/
│   ├── README.md
│   ├── package.json            // (if using Node.js)
│   ├── server.js               // Entry point for your backend API
│   ├── routes/
│   │   ├── auth.js             // Authentication endpoints (SSO/OAuth, JWT)
│   │   ├── articles.js         // Endpoints to create/read/update articles
│   │   └── podcasts.js         // Endpoints for podcast generation/retrieval
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── articleController.js
│   │   └── podcastController.js
│   ├── services/
│   │   ├── openaiService.js    // Handles communication with OpenAI API via proxy
│   │   └── supabaseService.js  // Wraps Supabase calls (metadata & storage)
│   ├── middlewares/
│   │   ├── authMiddleware.js   // For protecting routes
│   │   └── errorHandler.js     // Global error handling
│   └── config/
│       ├── config.js           // General configuration (env variables, etc.)
│       └── supabaseConfig.js   // Supabase-specific configuration
│
├── mobile/
│   ├── README.md
│   ├── package.json            // (if using React Native; similar config for Flutter)
│   ├── App.js                  // Entry point for the mobile app
│   ├── src/
│   │   ├── components/
│   │   │   ├── ArticleItem.js
│   │   │   ├── PodcastPlayer.js
│   │   │   └── AuthForm.js
│   │   ├── screens/
│   │   │   ├── HomeScreen.js
│   │   │   ├── ArticleScreen.js
│   │   │   └── PodcastScreen.js
│   │   ├── navigation/
│   │   │   └── AppNavigator.js
│   │   ├── services/
│   │   │   ├── api.js          // For communicating with the unified backend API
│   │   │   └── authService.js  // Handles authentication and session management
│   │   ├── assets/
│   │   │   ├── icons/
│   │   │   └── images/
│   │   └── utils/
│   │       └── storage.js      // Local caching/offline support
│   ├── android/                // Android-specific files (if applicable)
│   └── ios/                    // iOS-specific files (if applicable)
│
├── docs/
│   ├── architecture.md         // Overview of system architecture
│   ├── api.md                  // API documentation
│   ├── user-guides.md          // Guides for end users
│   
│
└── .gitignore


Current File Structure::

.
├── README.md
├── articles.html
├── articles.js
├── background.js
├── contentScript.js
├── contentScript.json
├── icons
│   ├── icon128.png
│   ├── icon16.png
│   ├── icon32.png
│   └── icon48.png
├── instructions
│   ├── instructions-to-cache.md
│   ├── instructions-to-contentScript.md
│   ├── instructions-to-full-scale.md
│   ├── instructions-to-podcast.md
│   └── instructions.md
├── manifest.json
├── options.html
├── options.js
├── popup.html
└── popup.js


Questions & Considerations
Data Migration Strategy
Will there be a transition period where both local and cloud storage are supported? No.
Should we implement a one-click migration tool for existing users? No.
Authentication Flow
Which OAuth providers should we prioritize? (Google seems natural for Chrome users) Google.
How will we handle token refresh and session persistence? Use the Google OAuth flow.
Offline Functionality
What's the sync conflict resolution strategy when multiple devices modify the same content offline? Let us worry about this later.
Should we implement a queue system for pending operations? Let us worry about this later.
API Rate Limiting
How will we handle OpenAI API costs and usage limits per user? Let us worry about this later.
Should we implement user quotas or tiered pricing? Let us worry about this later.
5. Mobile App Specifics
For React Native/Flutter, will we need native modules for audio playback? Let us worry about this later.
How will we handle background audio playback and downloads? Let us worry about this later.
Storage Considerations
Should we implement cleanup policies for unused audio files? Let us worry about this later.
What's the strategy for handling storage quotas per user? Let us worry about this later.