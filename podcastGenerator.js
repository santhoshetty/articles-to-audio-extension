/**
 * Podcast Generator Service for Article to Audio Extension (Local Version)
 * Handles the process of generating a complete podcast from articles
 */

import { generatePodcastScript } from './scriptGenerator.js';
import { generatePodcastAudio } from './audioGenerator.js';
import { estimateAudioDuration, formatDuration } from './utils.js';

/**
 * Generate a podcast from selected articles
 * This is the main function that combines script generation and audio generation
 * @param {Array<number>} articleIds - Array of article IDs
 * @param {Object} options - Generation options
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<Object>} Script data immediately, with audio generation continuing in background
 */
async function generatePodcast(articleIds, options = {}, progressCallback = () => {}) {
  // Create an AbortController for the entire podcast generation process
  const controller = new AbortController();
  const signal = controller.signal;
  
  // Add a method to the return value to allow cancellation
  const cancelPodcastGeneration = () => {
    console.log('Podcast generation has been cancelled by user');
    controller.abort();
    progressCallback({
      stage: 'cancelled',
      message: 'Podcast generation cancelled',
      progress: 0
    });
  };
  
  try {
    // Generate the script first
    const scriptData = await generatePodcastScript(articleIds, options, progressCallback, controller);
    
    // Add the cancel method to the script data
    scriptData.cancelGeneration = cancelPodcastGeneration;
    
    // Start audio generation in the background
    generatePodcastAudio(scriptData, progressCallback, controller)
      .then(audioData => {
        // When audio is complete, update the progress callback
        if (!signal.aborted) {
          progressCallback({
            stage: 'complete',
            message: 'Podcast generation complete',
            progress: 100,
            audioData
          });
        }
      })
      .catch(error => {
        // Only report errors that aren't from cancellation
        if (!signal.aborted) {
          progressCallback({
            stage: 'error',
            message: `Error generating podcast audio: ${error.message}`,
            error
          });
        }
      });
    
    // Return immediately with the script data
    return {
      ...scriptData,
      audioGenerationInProgress: true,
      cancelGeneration: cancelPodcastGeneration
    };
  } catch (error) {
    if (signal.aborted) {
      console.log('Podcast generation was cancelled');
      progressCallback({ stage: 'cancelled', message: 'Operation cancelled', progress: 0 });
    } else {
      console.error('Error in podcast generation:', error);
      progressCallback({ stage: 'error', message: error.message, error });
    }
    throw error;
  }
}

// Export functions
export {
  generatePodcast,
  generatePodcastScript,
  generatePodcastAudio,
  estimateAudioDuration,
  formatDuration
}; 