/**
 * Google Cloud Function for generating podcast audio from articles
 * 
 * This function takes article data, generates a podcast script,
 * converts it to audio, and stores the result in Supabase.
 */
const functions = require('@google-cloud/functions-framework');
const { processPodcastAudio } = require('./src/handlers/podcastHandler');

// Register the main function handler
functions.http('processPodcastAudio', processPodcastAudio);

// Export any utilities for potential reuse in other functions
module.exports = {
  // Export the handler function for testing or reuse
  processPodcastAudio
}; 