import {
  saveSetting,
  getSetting,
  getAllArticles,
  getAudioForArticle,
  exportDatabase,
  importDatabase,
  initializeDB,
  getDatabaseStats
} from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize database
  await initializeDB();
  
  // UI Elements
  const apiKeyInput = document.getElementById('openai-api-key');
  const saveApiKeyButton = document.getElementById('save-api-key');
  const testApiKeyButton = document.getElementById('test-api-key');
  const hostVoiceSelect = document.getElementById('host-voice');
  const cohostVoiceSelect = document.getElementById('cohost-voice');
  const saveVoiceSettingsButton = document.getElementById('save-voice-settings');
  const previewHostVoiceButton = document.getElementById('preview-host-voice');
  const previewCohostVoiceButton = document.getElementById('preview-cohost-voice');
  const exportDataButton = document.getElementById('export-data');
  const importDataButton = document.getElementById('import-data');
  const importFileInput = document.getElementById('import-file');
  const clearDataButton = document.getElementById('clear-data');
  
  // Load saved settings
  loadSettings();
  updateStorageStats();
  
  // Event listeners
  saveApiKeyButton.addEventListener('click', saveApiKey);
  testApiKeyButton.addEventListener('click', testApiKey);
  saveVoiceSettingsButton.addEventListener('click', saveVoiceSettings);
  previewHostVoiceButton.addEventListener('click', previewHostVoice);
  previewCohostVoiceButton.addEventListener('click', previewCohostVoice);
  exportDataButton.addEventListener('click', exportData);
  importDataButton.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', importData);
  clearDataButton.addEventListener('click', clearAllData);
  
  // Add event listeners to refresh stats when page regains focus or visibility
  window.addEventListener('focus', updateStorageStats);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateStorageStats();
    }
  });
  
  /**
   * Show status message
   * @param {string} message - Message to display
   * @param {string} type - Message type (success, error, warning, info)
   */
  function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }
  
  /**
   * Load saved settings from IndexedDB
   */
  async function loadSettings() {
    try {
      // Load API key
      const apiKey = await getSetting('openai_api_key');
      if (apiKey) {
        apiKeyInput.value = apiKey;
        showStatus('Settings loaded successfully', 'success');
      } else {
        showStatus('Please set your OpenAI API key to use this extension', 'warning');
      }
      
      // Load voice settings
      const hostVoice = await getSetting('host_voice');
      if (hostVoice) {
        hostVoiceSelect.value = hostVoice;
      } else {
        // If no host voice setting exists, save the default (which is now Echo)
        await saveSetting('host_voice', hostVoiceSelect.value);
      }
      
      const cohostVoice = await getSetting('cohost_voice');
      if (cohostVoice) {
        cohostVoiceSelect.value = cohostVoice;
      } else {
        // If no co-host voice setting exists, save the default (which is now Nova)
        await saveSetting('cohost_voice', cohostVoiceSelect.value);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showStatus('Error loading settings: ' + error.message, 'error');
    }
  }
  
  /**
   * Save API key to IndexedDB
   */
  async function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatus('Please enter a valid API key', 'error');
      return;
    }
    
    try {
      await saveSetting('openai_api_key', apiKey);
      showStatus('API key saved successfully', 'success');
    } catch (error) {
      console.error('Error saving API key:', error);
      showStatus('Error saving API key: ' + error.message, 'error');
    }
  }
  
  /**
   * Test OpenAI API connection
   */
  async function testApiKey() {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      showStatus('Please enter an API key first', 'error');
      return;
    }
    
    showStatus('Testing API connection...', 'info');
    
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      if (response.ok) {
        showStatus('API connection successful!', 'success');
      } else {
        const error = await response.json();
        showStatus(`API connection failed: ${error.error.message}`, 'error');
      }
    } catch (error) {
      console.error('Error testing API connection:', error);
      showStatus('Error testing API connection: ' + error.message, 'error');
    }
  }
  
  /**
   * Save voice settings to IndexedDB
   */
  async function saveVoiceSettings() {
    try {
      await saveSetting('host_voice', hostVoiceSelect.value);
      await saveSetting('cohost_voice', cohostVoiceSelect.value);
      showStatus('Voice settings saved successfully', 'success');
    } catch (error) {
      console.error('Error saving voice settings:', error);
      showStatus('Error saving voice settings: ' + error.message, 'error');
    }
  }
  
  /**
   * Update storage statistics
   */
  async function updateStorageStats() {
    try {
      const stats = await getDatabaseStats();
      
      // Update UI with stats
      document.getElementById('article-count').textContent = stats.articleCount;
      document.getElementById('audio-count').textContent = stats.audioCount;
      
      // Format storage size
      const sizeInMB = (stats.totalAudioSize / (1024 * 1024)).toFixed(2);
      document.getElementById('storage-used').textContent = `${sizeInMB} MB`;
      
      // Update storage bar (assuming a limit of 100MB for visualization)
      const storagePercent = Math.min(100, (stats.totalAudioSize / (100 * 1024 * 1024)) * 100);
      document.getElementById('storage-bar-fill').style.width = `${storagePercent}%`;
      
      console.log('Storage stats updated:', stats);
    } catch (error) {
      console.error('Error updating storage stats:', error);
      showStatus('Error updating storage statistics', 'error');
    }
  }
  
  /**
   * Export database data to a JSON file
   */
  async function exportData() {
    try {
      showStatus('Preparing data for export...', 'info');
      
      const data = await exportDatabase();
      
      // Create a Blob with the data
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      
      // Create a download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `article-to-audio-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showStatus('Data exported successfully', 'success');
    } catch (error) {
      console.error('Error exporting data:', error);
      showStatus('Error exporting data: ' + error.message, 'error');
    }
  }
  
  /**
   * Import database data from a JSON file
   */
  async function importData(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    try {
      showStatus('Importing data...', 'info');
      
      // Read the file
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          await importDatabase(data);
          showStatus('Data imported successfully', 'success');
          updateStorageStats();
        } catch (parseError) {
          console.error('Error parsing import file:', parseError);
          showStatus('Error parsing import file: ' + parseError.message, 'error');
        }
      };
      
      reader.onerror = () => {
        showStatus('Error reading import file', 'error');
      };
      
      reader.readAsText(file);
    } catch (error) {
      console.error('Error importing data:', error);
      showStatus('Error importing data: ' + error.message, 'error');
    }
    
    // Reset the input
    event.target.value = '';
  }
  
  /**
   * Clear all data from IndexedDB
   */
  async function clearAllData() {
    if (!confirm('Are you sure you want to clear all data? This action cannot be undone!')) {
      return;
    }
    
    try {
      showStatus('Clearing all data...', 'info');
      
      // The simplest way to clear all data is to delete the database and recreate it
      const deleteRequest = indexedDB.deleteDatabase('ArticleToAudioDB');
      
      deleteRequest.onsuccess = async () => {
        // Reinitialize the database
        await initializeDB();
        
        // Update stats
        updateStorageStats();
        
        showStatus('All data cleared successfully', 'success');
      };
      
      deleteRequest.onerror = (event) => {
        console.error('Error clearing data:', event.target.error);
        showStatus('Error clearing data: ' + event.target.error, 'error');
      };
    } catch (error) {
      console.error('Error clearing data:', error);
      showStatus('Error clearing data: ' + error.message, 'error');
    }
  }
  
  /**
   * Preview the host voice
   */
  async function previewHostVoice() {
    const voice = hostVoiceSelect.value;
    await playVoicePreview(voice);
  }

  /**
   * Preview the co-host voice
   */
  async function previewCohostVoice() {
    const voice = cohostVoiceSelect.value;
    await playVoicePreview(voice);
  }

  /**
   * Play a sample of the selected voice
   * @param {string} voice - The voice ID (e.g., "alloy", "onyx")
   */
  async function playVoicePreview(voice) {
    try {
      const voiceNameMap = {
        'alloy': 'Esha',
        'echo': 'Hari',
        'fable': 'Mira',
        'onyx': 'Tej',
        'nova': 'Leela',
        'shimmer': 'Veena'
      };
      
      // Show status with the mapped name
      showStatus(`Loading ${voiceNameMap[voice]} voice sample...`, 'info');
      
      // Get the OpenAI API key
      const apiKey = await getSetting('openai_api_key');
      if (!apiKey) {
        throw new Error('OpenAI API key not set. Please set your API key first.');
      }
      
      // Sample text for each voice using mapped names
      const sampleTexts = {
        'alloy': `Hi, I'm Esha. I am a versatile voice that can adapt to various content styles.`,
        'echo': `Hi, I'm Hari. I have a soft-spoken and articulate voice, ideal for educational content.`,
        'fable': `Hi, I'm Mira. I have a narration style that's great for storytelling and creative content.`,
        'onyx': `Hi, I'm Tej. I have a deep, authoritative voice suited for professional presentations.`,
        'nova': `Hi, I'm Leela. My voice is clear and energetic, good for delivering news or explanations.`,
        'shimmer': `Hi, I'm Veena. I have a warm, welcoming voice perfect for friendly conversations.`
      };
      
      // Use the sample text for the selected voice or a default
      const text = sampleTexts[voice] || `This is a sample of the ${voice} voice.`;
      
      // Create a button that's already in the DOM to disable
      const previewButtons = document.querySelectorAll('#preview-host-voice, #preview-cohost-voice');
      previewButtons.forEach(btn => {
        btn.disabled = true;
        btn.textContent = 'Loading...';
      });
      
      // Generate the audio
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: voice,
          input: text
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }
      
      // Convert the response to a blob
      const audioBlob = await response.blob();
      
      // Create a URL for the audio blob
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create an audio element to play the sample
      const audioElement = new Audio(audioUrl);
      audioElement.onended = () => {
        // Clean up the object URL when done playing
        URL.revokeObjectURL(audioUrl);
        // Re-enable the preview buttons
        previewButtons.forEach(btn => {
          btn.disabled = false;
          btn.textContent = 'Preview Voice';
        });
      };
      
      // Play the audio
      audioElement.play();
      showStatus(`Playing ${voiceNameMap[voice]} voice sample`, 'success');
      
    } catch (error) {
      console.error('Error playing voice sample:', error);
      showStatus(`Error playing voice sample: ${error.message}`, 'error');
      
      // Re-enable the preview buttons
      const previewButtons = document.querySelectorAll('#preview-host-voice, #preview-cohost-voice');
      previewButtons.forEach(btn => {
        btn.disabled = false;
        btn.textContent = 'Preview Voice';
      });
    }
  }
}); 