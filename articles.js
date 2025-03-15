/**
 * Articles page functionality for Article to Audio Extension (Local Version)
 * Handles displaying, searching, and selecting articles for podcast generation
 */

import {
  getAllArticles,
  getArticleById,
  deleteArticle,
  getAudioForArticle,
  getSetting,
  exportDatabase,
  DB_NAME,
  DB_VERSION,
  saveSetting
} from './db.js';

import {
  generatePodcast,
  formatDuration,
  estimateAudioDuration
} from './podcastGenerator.js';

// Global variables
let allArticles = [];
let filteredArticles = [];
let selectedArticles = new Set();
let currentPage = 1;
let articlesPerPage = 12;
let currentPodcastId = null;
let currentPodcastScriptData = null;
let allPodcasts = [];
let selectedPodcasts = new Set();

// Store expanded article IDs for persistence
const expandedArticles = new Set();

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', initializeUI);

/**
 * Initialize the UI
 */
function initializeUI() {
  // Load articles
  loadArticles().then(() => {
    // Initial display
    displayArticles(allArticles);
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Load podcasts tab
    loadPodcasts();
    
    // Check for API key
    initializeVoiceSettings();
    
    // Set the initial view to articles
    switchView('articles');
  });
}

/**
 * Initialize voice settings from saved preferences
 */
async function initializeVoiceSettings() {
  const hostVoiceSelect = document.getElementById('hostVoiceSelect');
  const cohostVoiceSelect = document.getElementById('cohostVoiceSelect');

  const hostVoice = await getSetting('host_voice');
  if (hostVoice) {
    hostVoiceSelect.value = hostVoice;
  }

  const cohostVoice = await getSetting('cohost_voice');
  if (cohostVoice) {
    cohostVoiceSelect.value = cohostVoice;
  }
}

/**
 * Load all articles from IndexedDB
 */
async function loadArticles() {
  try {
    // Get all articles from IndexedDB
    allArticles = await getAllArticles();
    
    // Sort by date (newest first)
    allArticles.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    
    // Reset filtered articles
    filteredArticles = [...allArticles];
    
    // Display articles
    displayArticles(filteredArticles);
    
    // Reset selection
    selectedArticles.clear();
    updateButtonsState();
    
    // Check for OpenAI API key
    const apiKey = await getSetting('openai_api_key');
    if (!apiKey) {
      showStatus(
        'OpenAI API key not set. Please go to settings and add your API key to generate podcasts.',
        'warning'
      );
    }
  } catch (error) {
    console.error('Error loading articles:', error);
    showStatus(`Error loading articles: ${error.message}`, 'error');
  }
}

/**
 * Filter articles by date range
 * @param {Date} startDate - Start date for filtering (inclusive)
 * @param {Date} endDate - End date for filtering (inclusive)
 */
function filterArticlesByDate(startDate, endDate) {
  // If no dates are provided, reset to all articles
  if (!startDate && !endDate) {
    filteredArticles = [...allArticles];
    currentPage = 1;
    displayArticles(filteredArticles);
    return;
  }
  
  // Set default dates if not provided
  if (!startDate) {
    startDate = new Date(0); // Beginning of time
  }
  
  if (!endDate) {
    endDate = new Date(); // Current date
  }
  
  // Set time to end of day for the end date to include the entire day
  endDate = new Date(endDate);
  endDate.setHours(23, 59, 59, 999);
  
  // Filter articles
  filteredArticles = allArticles.filter(article => {
    const articleDate = new Date(article.dateAdded);
    return articleDate >= startDate && articleDate <= endDate;
  });
  
  // Reset pagination
  currentPage = 1;
  
  // Display filtered articles
  displayArticles(filteredArticles);
  
  // Show status
  const count = filteredArticles.length;
  showStatus(`Showing ${count} article${count !== 1 ? 's' : ''} in the selected date range`, 'info');
}

/**
 * Apply date filter from form inputs
 */
function applyDateFilter() {
  const startDateInput = document.getElementById('startDateFilter');
  const endDateInput = document.getElementById('endDateFilter');
  
  let startDate = startDateInput.value ? new Date(startDateInput.value) : null;
  let endDate = endDateInput.value ? new Date(endDateInput.value) : null;
  
  filterArticlesByDate(startDate, endDate);
}

/**
 * Reset date filter
 */
function resetDateFilter() {
  const startDateInput = document.getElementById('startDateFilter');
  const endDateInput = document.getElementById('endDateFilter');
  
  startDateInput.value = '';
  endDateInput.value = '';
  
  filterArticlesByDate(null, null);
}

/**
 * Apply quick date filter
 * @param {string} period - Time period to filter by ('today', 'week', 'month', 'year')
 */
function applyQuickDateFilter(period) {
  const now = new Date();
  let startDate;
  
  switch (period) {
    case 'today':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate = null;
      break;
  }
  
  // Update the date inputs to match the selection
  const startDateInput = document.getElementById('startDateFilter');
  const endDateInput = document.getElementById('endDateFilter');
  
  if (startDate) {
    startDateInput.value = startDate.toISOString().split('T')[0];
  } else {
    startDateInput.value = '';
  }
  
  endDateInput.value = now.toISOString().split('T')[0];
  
  filterArticlesByDate(startDate, now);
}

/**
 * Display articles with pagination
 * @param {Array} articles - Articles to display
 */
function displayArticles(articles) {
  const container = document.getElementById('articles-container');
  
  // Clear container
  container.innerHTML = '';
  
  if (articles.length === 0) {
    container.innerHTML = '<div class="no-articles">No articles found. Save some articles first!</div>';
    return;
  }
  
  // Calculate pagination
  const totalPages = Math.ceil(articles.length / articlesPerPage);
  if (currentPage > totalPages) {
    currentPage = 1;
  }
  
  // Get current page articles
  const startIndex = (currentPage - 1) * articlesPerPage;
  const endIndex = Math.min(startIndex + articlesPerPage, articles.length);
  const currentArticles = articles.slice(startIndex, endIndex);
  
  // Render articles
  currentArticles.forEach(article => {
    const card = createArticleCard(article);
    container.appendChild(card);
    
    // Restore expanded state if needed
    if (expandedArticles.has(article.id)) {
      const fullContent = card.querySelector('.card-full-content');
      const toggleIcon = card.querySelector('.toggle-icon');
      const toggleText = card.querySelector('.toggle-text');
      
      fullContent.style.display = 'block';
      toggleIcon.textContent = '▲';
      toggleText.textContent = 'Hide Full Article';
    }
  });
  
  // Update pagination
  updatePagination(totalPages);
}

/**
 * Create an article card element
 * @param {Object} article - Article data
 * @returns {HTMLElement} Article card element
 */
function createArticleCard(article) {
  const card = document.createElement('div');
  card.className = 'article-card';
  card.dataset.id = article.id;
  
  // Format date
  const date = new Date(article.dateAdded);
  const formattedDate = date.toLocaleDateString(undefined, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
  
  // Prepare the summary text (truncated)
  const summaryText = article.summary || article.content.slice(0, 150) + '...';
  
  // Calculate word count and reading time
  const wordCount = article.content.split(/\s+/).length;
  const readingTimeMinutes = Math.ceil(wordCount / 200); // Assuming 200 words per minute
  
  // Create card content
  card.innerHTML = `
    <div class="card-header">
      <label class="checkbox-container">
        <input type="checkbox" class="article-checkbox" data-id="${article.id}" ${selectedArticles.has(article.id) ? 'checked' : ''}>
        <span class="checkmark"></span>
      </label>
      <h3 class="card-title">${article.title || 'Untitled Article'}</h3>
    </div>
    <div class="card-body">
      <div class="card-content">
        <p class="card-summary">${summaryText}</p>
        <div class="card-full-content" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border-color);">
          <div class="article-stats" style="margin-bottom: 10px; font-size: 12px; color: var(--text-light);">
            <span>${wordCount.toLocaleString()} words</span> • 
            <span>~${readingTimeMinutes} min read</span>
          </div>
          <div class="full-text" style="max-height: 300px; overflow-y: auto;">${article.content}</div>
        </div>
      </div>
      <button class="toggle-content-btn" aria-label="Toggle full content">
        <span class="toggle-icon">▼</span>
        <span class="toggle-text">Show Full Article</span>
      </button>
    </div>
    <div class="card-footer">
      <div class="meta-info">
        <div>${formattedDate}</div>
        <div>${article.url ? new URL(article.url).hostname : 'No URL'}</div>
      </div>
      <div class="card-actions">
        <button class="view-btn" title="View Article" data-id="${article.id}">👁️</button>
        <button class="delete-btn" title="Delete Article" data-id="${article.id}">🗑️</button>
      </div>
    </div>
  `;
  
  // Add event listeners
  const checkbox = card.querySelector('.article-checkbox');
  checkbox.addEventListener('change', (e) => {
    toggleArticleSelection(article.id, e.target.checked);
  });
  
  const viewBtn = card.querySelector('.view-btn');
  viewBtn.addEventListener('click', () => {
    if (article.url) {
      window.open(article.url, '_blank');
    } else {
      showStatus('No URL available for this article', 'warning');
    }
  });
  
  const deleteBtn = card.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Are you sure you want to delete "${article.title || 'this article'}"?`)) {
      deleteArticleById(article.id);
    }
  });
  
  // Add toggle functionality for full content
  const toggleBtn = card.querySelector('.toggle-content-btn');
  const fullContent = card.querySelector('.card-full-content');
  const toggleIcon = card.querySelector('.toggle-icon');
  const toggleText = card.querySelector('.toggle-text');
  
  toggleBtn.addEventListener('click', () => {
    const isExpanded = fullContent.style.display !== 'none';
    const articleId = article.id;
    
    if (isExpanded) {
      fullContent.style.display = 'none';
      toggleIcon.textContent = '▼';
      toggleText.textContent = 'Show Full Article';
      // Remove from expanded set
      expandedArticles.delete(articleId);
    } else {
      fullContent.style.display = 'block';
      toggleIcon.textContent = '▲';
      toggleText.textContent = 'Hide Full Article';
      // Add to expanded set
      expandedArticles.add(articleId);
    }
  });
  
  return card;
}

/**
 * Update pagination controls
 * @param {number} totalPages - Total number of pages
 */
function updatePagination(totalPages) {
  const pagination = document.getElementById('pagination');
  pagination.innerHTML = '';
  
  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }
  
  pagination.style.display = 'flex';
  
  // Previous page button
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '&laquo;';
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      displayArticles(filteredArticles);
    }
  });
  pagination.appendChild(prevBtn);
  
  // Page buttons
  const maxButtons = 5;
  const startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  const endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('button');
    pageBtn.textContent = i;
    pageBtn.className = i === currentPage ? 'active' : '';
    pageBtn.addEventListener('click', () => {
      currentPage = i;
      displayArticles(filteredArticles);
    });
    pagination.appendChild(pageBtn);
  }
  
  // Next page button
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = '&raquo;';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      displayArticles(filteredArticles);
    }
  });
  pagination.appendChild(nextBtn);
}

/**
 * Toggle selection of an article
 * @param {number} articleId - Article ID
 * @param {boolean} selected - Whether the article is selected
 */
function toggleArticleSelection(articleId, selected) {
  if (selected) {
    selectedArticles.add(articleId);
  } else {
    selectedArticles.delete(articleId);
  }
  
  updateButtonsState();
}

/**
 * Toggle selection of all articles
 * @param {Event} event - Change event
 */
function toggleSelectAll(event) {
  const isChecked = event.target.checked;
  
  // Update all checkboxes
  document.querySelectorAll('.article-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
    toggleArticleSelection(parseInt(checkbox.dataset.id), isChecked);
  });
  
  updateButtonsState();
}

/**
 * Update the state of action buttons based on selection
 */
function updateButtonsState() {
  const generatePodcastBtn = document.getElementById('generatePodcastBtn');
  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  
  const hasSelection = selectedArticles.size > 0;
  
  generatePodcastBtn.disabled = !hasSelection;
  exportSelectedBtn.disabled = !hasSelection;
  deleteSelectedBtn.disabled = !hasSelection;
}

/**
 * Search articles by title or content
 * @param {string} query - Search query
 */
function searchArticles(query) {
  if (!query || query.trim() === '') {
    filteredArticles = [...allArticles];
  } else {
    query = query.toLowerCase().trim();
    filteredArticles = allArticles.filter(article => {
      const title = (article.title || '').toLowerCase();
      const content = (article.content || '').toLowerCase();
      const summary = (article.summary || '').toLowerCase();
      
      return title.includes(query) || content.includes(query) || summary.includes(query);
    });
  }
  
  currentPage = 1;
  displayArticles(filteredArticles);
}

/**
 * Delete an article by ID
 * @param {number} articleId - Article ID
 */
async function deleteArticleById(articleId) {
  try {
    await deleteArticle(articleId);
    
    // Remove from arrays and selection
    allArticles = allArticles.filter(article => article.id !== articleId);
    filteredArticles = filteredArticles.filter(article => article.id !== articleId);
    selectedArticles.delete(articleId);
    
    // Update UI
    displayArticles(filteredArticles);
    updateButtonsState();
    
    showStatus('Article deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting article:', error);
    showStatus(`Error deleting article: ${error.message}`, 'error');
  }
}

/**
 * Delete all selected articles
 */
async function deleteSelectedArticles() {
  if (selectedArticles.size === 0) return;
  
  const confirmMessage = selectedArticles.size === 1
    ? 'Are you sure you want to delete the selected article?'
    : `Are you sure you want to delete ${selectedArticles.size} selected articles?`;
  
  if (!confirm(confirmMessage)) return;
  
  try {
    const deletePromises = Array.from(selectedArticles).map(id => deleteArticle(id));
    await Promise.all(deletePromises);
    
    // Update arrays
    allArticles = allArticles.filter(article => !selectedArticles.has(article.id));
    filteredArticles = filteredArticles.filter(article => !selectedArticles.has(article.id));
    
    // Clear selection
    selectedArticles.clear();
    
    // Update UI
    displayArticles(filteredArticles);
    updateButtonsState();
    
    showStatus('Selected articles deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting articles:', error);
    showStatus(`Error deleting articles: ${error.message}`, 'error');
  }
}

/**
 * Export selected articles
 */
async function exportSelectedArticles() {
  if (selectedArticles.size === 0) return;
  
  try {
    // Get full articles for the selected IDs
    const selectedArticlesData = await Promise.all(
      Array.from(selectedArticles).map(id => getArticleById(id))
    );
    
    // Get audio files for the selected articles
    const audioData = [];
    for (const article of selectedArticlesData) {
      const audioFiles = await getAudioForArticle(article.id);
      audioData.push(...audioFiles);
    }
    
    // Create export data
    const exportData = {
      articles: selectedArticlesData,
      audio: audioData,
      exportDate: new Date().toISOString(),
      version: '1.0'
    };
    
    // Create and download JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `article-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus(`${selectedArticlesData.length} articles exported successfully`, 'success');
  } catch (error) {
    console.error('Error exporting articles:', error);
    showStatus(`Error exporting articles: ${error.message}`, 'error');
  }
}

/**
 * Validate voice selections and update Generate button state
 */
function validateVoiceSelections() {
  const hostVoice = document.getElementById('hostVoiceSelect').value;
  const cohostVoice = document.getElementById('cohostVoiceSelect').value;
  const startGenerateBtn = document.getElementById('startGenerateBtn');
  
  // Enable the Generate button only if both voices are selected and they are different
  startGenerateBtn.disabled = !hostVoice || !cohostVoice || hostVoice === cohostVoice;
  
  if (hostVoice && cohostVoice && hostVoice === cohostVoice) {
    showStatus('Please select different voices for host and co-host', 'warning');
  }
}

/**
 * Open the generate podcast modal
 */
async function openGeneratePodcastModal() {
  console.log('openGeneratePodcastModal called, selectedArticles size:', selectedArticles.size);
  
  if (selectedArticles.size === 0) {
    console.log('No articles selected, returning...');
    return;
  }
  
  // Get the modal and title input
  const modal = document.getElementById('generatePodcastModal');
  const titleInput = document.getElementById('podcastTitle');
  
  if (!modal || !titleInput) {
    console.error('Modal or title input not found!');
    return;
  }
  
  console.log('Setting up the modal...');
  
  // Reset the modal
  document.getElementById('progressContainer').style.display = 'none';
  document.getElementById('generatedPodcast').style.display = 'none';
  document.getElementById('startGenerateBtn').style.display = 'block';
  document.getElementById('downloadPodcastBtn').style.display = 'none';
  
  // Set default title as current date in format "15 Mar, 2025"
  const now = new Date();
  const day = now.getDate();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const year = now.getFullYear();
  titleInput.value = `${day} ${month}, ${year}`;
  
  // Load voice settings from storage
  try {
    const hostVoice = await getSetting('host_voice');
    if (hostVoice) {
      document.getElementById('hostVoiceSelect').value = hostVoice;
    }
    
    const cohostVoice = await getSetting('cohost_voice');
    if (cohostVoice) {
      document.getElementById('cohostVoiceSelect').value = cohostVoice;
    }
  } catch (error) {
    console.error('Error loading voice settings:', error);
  }
  
  // Validate initial voice selections
  validateVoiceSelections();
  
  // Display the modal
  console.log('Displaying the modal...');
  modal.style.display = 'flex';
}

/**
 * Close the generate podcast modal
 */
function closeGeneratePodcastModal() {
  const modal = document.getElementById('generatePodcastModal');
  modal.style.display = 'none';
}

/**
 * Start podcast generation
 */
async function startPodcastGeneration() {
  if (selectedArticles.size === 0) return;
  
  // Get selected articles
  const articleIds = Array.from(selectedArticles);
  
  // Get options from form
  const title = document.getElementById('podcastTitle').value;
  const hostVoice = document.getElementById('hostVoiceSelect').value;
  const cohostVoice = document.getElementById('cohostVoiceSelect').value;
  const includeIntro = document.getElementById('includeIntro').checked;
  const includeConclusion = document.getElementById('includeConclusion').checked;
  
  // Save the selected voices to storage so they're remembered for next time
  try {
    await saveSetting('host_voice', hostVoice);
    await saveSetting('cohost_voice', cohostVoice);
  } catch (error) {
    console.error('Error saving voice settings:', error);
    // Continue anyway - this is not critical
  }
  
  // Voice to name mapping
  const voiceNameMap = {
    'alloy': 'Esha',
    'echo': 'Hari',
    'fable': 'Mira',
    'onyx': 'Tej',
    'nova': 'Leela',
    'shimmer': 'Veena'
  };
  
  // Get host names from the mapping
  const hostName = voiceNameMap[hostVoice];
  const cohostName = voiceNameMap[cohostVoice];
  
  // Prepare UI for generation
  document.getElementById('progressContainer').style.display = 'block';
  document.getElementById('startGenerateBtn').disabled = true;
  document.getElementById('progressText').textContent = `Starting podcast generation with ${hostName} and ${cohostName}...`;
  document.getElementById('progressFill').style.width = '5%';
  
  try {
    // Check for API key
    const apiKey = await getSetting('openai_api_key');
    if (!apiKey) {
      throw new Error('OpenAI API key not set. Please go to settings and add your API key.');
    }
    
    // Set up options
    const options = {
      title,
      voiceMap: {
        'HOST': hostVoice,
        'CO-HOST': cohostVoice
      },
      hostNames: {
        'HOST': hostName,
        'CO-HOST': cohostName
      },
      includeIntroduction: includeIntro,
      includeConclusion: includeConclusion,
      // Add explicit name replacements
      nameReplacements: {
        'Alice': hostName,
        'Bob': cohostName
      }
    };
    
    // Generate podcast script and start audio generation in background
    const podcastData = await generatePodcast(articleIds, options, updateProgress);
    
    // Show the generated podcast script immediately
    document.getElementById('generatedPodcast').style.display = 'block';
    document.getElementById('startGenerateBtn').style.display = 'none';
    
    // Show the script in the UI
    const scriptElement = document.getElementById('podcastScript') || document.createElement('div');
    if (!document.getElementById('podcastScript')) {
      scriptElement.id = 'podcastScript';
      scriptElement.style.display = 'none';
      scriptElement.style.maxHeight = '300px';
      scriptElement.style.overflowY = 'auto';
      scriptElement.style.border = '1px solid var(--border-color)';
      scriptElement.style.borderRadius = '6px';
      scriptElement.style.padding = '15px';
      scriptElement.style.background = '#f8f9fa';
      scriptElement.style.whiteSpace = 'pre-wrap';
      scriptElement.style.lineHeight = '1.5';
      document.querySelector('.script-container').appendChild(scriptElement);
    }
    
    // Color-code the script based on speaker
    const coloredScript = podcastData.script
      .split('\n')
      .map(line => {
        // Get the first word before the colon (the speaker name)
        const speaker = line.split(':')[0];
        
        // Replace HOST/CO-HOST with actual names if present
        let processedLine = line;
        if (line.startsWith('HOST:')) {
          processedLine = line.replace('HOST:', `${hostName}:`);
        } else if (line.startsWith('CO-HOST:')) {
          processedLine = line.replace('CO-HOST:', `${cohostName}:`);
        }
        
        // Color based on the speaker name
        if (speaker === hostName || speaker === 'HOST') {
          return `<span style="color: #2563eb;">${processedLine}</span>`;
        } else if (speaker === cohostName || speaker === 'CO-HOST') {
          return `<span style="color: #dc2626;">${processedLine}</span>`;
        }
        return processedLine;
      })
      .join('\n');
    
    // Set the script content with colors
    scriptElement.innerHTML = coloredScript;
    
    // Set up script toggle
    const scriptToggle = document.getElementById('scriptToggle');
    if (scriptToggle) {
      // Remove existing event listeners by cloning and replacing
      const newScriptToggle = scriptToggle.cloneNode(true);
      scriptToggle.parentNode.replaceChild(newScriptToggle, scriptToggle);
      
      // Add new event listener
      newScriptToggle.addEventListener('click', function() {
        const scriptContainer = document.getElementById('podcastScript');
        if (scriptContainer.style.display === 'none') {
          scriptContainer.style.display = 'block';
          newScriptToggle.textContent = 'Hide Script';
        } else {
          scriptContainer.style.display = 'none';
          newScriptToggle.textContent = 'Show Script';
        }
      });
    }
    
    // Audio is being generated in the background
    // Show a message that audio is being generated
    const audioStatusElement = document.getElementById('audioStatus') || document.createElement('div');
    if (!document.getElementById('audioStatus')) {
      audioStatusElement.id = 'audioStatus';
      audioStatusElement.className = 'audio-status';
      document.getElementById('generatedPodcast').appendChild(audioStatusElement);
    }
    audioStatusElement.innerHTML = '<p>Audio is being generated in the background. The player will appear when ready.</p>';
    
    // The download button will be shown when audio generation is complete
    document.getElementById('downloadPodcastBtn').style.display = 'none';
    
    // Store script data for future reference
    currentPodcastScriptData = podcastData;
    
    // Store the generated podcast ID
    currentPodcastId = podcastData.podcastId;
    
    // Show the generated podcast
    document.getElementById('generatedPodcast').style.display = 'block';
    document.getElementById('startGenerateBtn').style.display = 'none';
    document.getElementById('downloadPodcastBtn').style.display = 'block';
    
    // Set up audio player
    const audioPlayer = document.getElementById('audioPlayer');
    const audio = await getAudioById(podcastData.podcastId);
    
    if (audio && audio.blob) {
      const audioUrl = URL.createObjectURL(audio.blob);
      audioPlayer.src = audioUrl;
      
      // Show podcast info
      const duration = safeFormatDuration(safeEstimateAudioDuration(podcastData.duration));
      const sizeInMb = (podcastData.size / (1024 * 1024)).toFixed(2);
      document.getElementById('podcastInfo').textContent = 
        `Duration: ${duration} | Size: ${sizeInMb} MB | Articles: ${articleIds.length}`;
        
      // Add podcast script to the display
      if (audio.script) {
        const scriptContainer = document.getElementById('podcastScript');
        scriptContainer.textContent = audio.script;
        
        // Set up script toggle
        const scriptToggle = document.getElementById('scriptToggle');
        scriptToggle.addEventListener('click', function() {
          const scriptContainer = document.getElementById('podcastScript');
          if (scriptContainer.style.display === 'none') {
            scriptContainer.style.display = 'block';
            scriptToggle.textContent = 'Hide Script';
          } else {
            scriptContainer.style.display = 'none';
            scriptToggle.textContent = 'Show Script';
          }
        });
      }
    }
  } catch (error) {
    console.error('Error generating podcast:', error);
    document.getElementById('progressText').textContent = `Error: ${error.message}`;
    document.getElementById('progressFill').style.backgroundColor = 'var(--error-color)';
  } finally {
    document.getElementById('startGenerateBtn').disabled = false;
  }
}

/**
 * Download the generated podcast
 */
async function downloadPodcast() {
  if (!currentPodcastId) return;
  
  try {
    const podcast = await getAudioById(currentPodcastId);
    
    if (!podcast || !podcast.blob) {
      throw new Error('Podcast audio not found');
    }
    
    // Create download link
    const url = URL.createObjectURL(podcast.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podcast.title || 'podcast'}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading podcast:', error);
    showStatus(`Error downloading podcast: ${error.message}`, 'error');
  }
}

/**
 * Get audio by ID
 * @param {number} id - Audio ID
 * @returns {Promise<Object>} Audio object
 */
async function getAudioById(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event) => {
      reject(new Error("Failed to open database."));
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["audio"], "readonly");
      const store = transaction.objectStore("audio");
      const getRequest = store.get(id);
      
      getRequest.onsuccess = (event) => {
        resolve(event.target.result);
      };
      
      getRequest.onerror = (event) => {
        reject(new Error("Failed to retrieve audio file."));
      };
    };
  });
}

/**
 * Update progress UI and handle completion events
 * @param {Object} progress - Progress information
 */
async function updateProgress(progress) {
  const progressText = document.getElementById('progressText');
  const progressFill = document.getElementById('progressFill');
  
  if (progress.error) {
    progressText.textContent = `Error: ${progress.message}`;
    progressFill.style.backgroundColor = 'var(--error-color)';
    return;
  }
  
  progressText.textContent = progress.message || 'Processing...';
  progressFill.style.width = `${progress.progress || 0}%`;
  
  if (progress.stage === 'complete') {
    document.getElementById('progressText').textContent = 'Podcast generation complete';
    document.getElementById('progressFill').style.width = '100%';
    
    // Show download button
    const downloadBtn = document.getElementById('downloadPodcastBtn');
    downloadBtn.style.display = 'block';
    
    // Remove existing event listeners by cloning and replacing
    const newDownloadBtn = downloadBtn.cloneNode(true);
    downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
    
    // Add new event listener
    newDownloadBtn.addEventListener('click', downloadPodcast);
    
    // Update the UI to show the audio player
    const audioStatusElement = document.getElementById('audioStatus');
    if (audioStatusElement) {
      audioStatusElement.innerHTML = '<p>Audio generation complete!</p>';
    }
    
    // Show download button
    document.getElementById('downloadPodcastBtn').style.display = 'block';
    
    // Set up audio player
    const audioPlayer = document.getElementById('audioPlayer');
    
    getAudioById(progress.audioData.podcastId).then(audio => {
      if (audio && audio.blob) {
        const url = URL.createObjectURL(audio.blob);
        audioPlayer.src = url;
        audioPlayer.style.display = 'block';
        
        // Show podcast info
        const duration = safeFormatDuration(progress.audioData.duration);
        const sizeInMb = (progress.audioData.size / (1024 * 1024)).toFixed(2);
        document.getElementById('podcastInfo').textContent = 
          `Duration: ${duration} | Size: ${sizeInMb} MB | Articles: ${progress.audioData?.articleIds?.length || 'Unknown'}`;
      }
    }).catch(error => {
      console.error('Error loading audio:', error);
      showStatus(`Error loading audio: ${error.message}`, 'error');
    });
  }
}

/**
 * Show a status message
 * @param {string} message - Message to show
 * @param {string} type - Message type (success, error, warning)
 */
function showStatus(message, type) {
  const statusMessage = document.getElementById('statusMessage');
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';
  
  setTimeout(() => {
    statusMessage.style.display = 'none';
  }, 5000);
}

/**
 * Switch between articles and podcasts view
 * @param {string} view - View to switch to ('articles' or 'podcasts')
 */
function switchView(view) {
  // Only handle the views that actually exist
  if (view !== 'articles' && view !== 'podcasts') {
    console.warn(`Invalid view: ${view}. Only 'articles' and 'podcasts' are supported.`);
    return;
  }
  
  const articlesView = document.getElementById('articlesView');
  const podcastsView = document.getElementById('podcastsView');
  const viewArticlesBtn = document.getElementById('viewArticlesBtn');
  const viewPodcastsBtn = document.getElementById('viewPodcastsBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  
  if (!articlesView || !podcastsView) {
    console.error('Required view elements are missing.');
    return;
  }
  
  // Remove existing listener to avoid duplicates
  if (deleteSelectedBtn) {
    // Clone and replace to remove all event listeners
    const newDeleteBtn = deleteSelectedBtn.cloneNode(true);
    deleteSelectedBtn.parentNode.replaceChild(newDeleteBtn, deleteSelectedBtn);
  }
  
  if (view === 'articles') {
    // Switch to articles view
    articlesView.style.display = 'block';
    podcastsView.style.display = 'none';
    
    if (viewArticlesBtn && viewPodcastsBtn) {
      viewArticlesBtn.classList.add('active');
      viewPodcastsBtn.classList.remove('active');
    }
    
    // Clear podcast selections
    selectedPodcasts.clear();
    
    // Set delete button to handle article deletions
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteSelectedArticles);
      updateButtonsState(); // Update based on selected articles
    }
  } else if (view === 'podcasts') {
    // Switch to podcasts view
    articlesView.style.display = 'none';
    podcastsView.style.display = 'block';
    
    if (viewArticlesBtn && viewPodcastsBtn) {
      viewArticlesBtn.classList.remove('active');
      viewPodcastsBtn.classList.add('active');
    }
    
    // Clear article selections
    selectedArticles.clear();
    
    // Set delete button to handle podcast deletions
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteSelectedPodcasts);
      updatePodcastButtonsState(); // Update based on selected podcasts
    }
    
    loadPodcasts();
  }
}

/**
 * Load all podcasts from the database
 */
async function loadPodcasts() {
  try {
    allPodcasts = await getAllPodcasts();
    displayPodcasts(allPodcasts);
  } catch (error) {
    console.error('Error loading podcasts:', error);
    showStatus('Error loading podcasts: ' + error.message, 'error');
  }
}

/**
 * Get all podcasts from the database
 * @returns {Promise<Array>} Array of podcast objects
 */
async function getAllPodcasts() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      reject(new Error("Failed to open database."));
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["audio"], "readonly");
      const store = transaction.objectStore("audio");
      const index = store.index("type");
      const query = IDBKeyRange.only("podcast");
      const podcasts = [];
      
      index.openCursor(query).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          // Don't include the blob in the results to save memory
          const podcast = { ...cursor.value };
          delete podcast.blob;
          podcasts.push(podcast);
          cursor.continue();
        } else {
          // Sort by date created (newest first)
          podcasts.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));
          resolve(podcasts);
        }
      };
      
      transaction.onerror = () => {
        reject(new Error("Failed to retrieve podcasts."));
      };
    };
  });
}

/**
 * Display podcasts in the UI
 * @param {Array} podcasts - Array of podcast objects
 */
function displayPodcasts(podcasts) {
  const container = document.getElementById('podcasts-container');
  container.innerHTML = '';
  
  // Add select all checkbox for podcasts - now at the top with improved styling
  const selectAllContainer = document.createElement('div');
  selectAllContainer.className = 'select-all-container';
  selectAllContainer.style.cssText = 'padding: 15px 0; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);';
  selectAllContainer.innerHTML = `
    <label class="checkbox-container" style="display: inline-flex; align-items: center; font-size: 15px; color: var(--text-color); font-weight: 500;">
      <input type="checkbox" id="selectAllPodcastsCheckbox">
      <span class="checkmark"></span>
      <span class="checkbox-label" style="margin-left: 24px; white-space: nowrap;">Select All Podcasts</span>
    </label>
  `;
  container.appendChild(selectAllContainer);
  
  if (!podcasts || podcasts.length === 0) {
    container.innerHTML += `<div class="no-podcasts" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
      <p>No podcasts found. Generate a podcast from articles to see them here.</p>
    </div>`;
    return;
  }
  
  // Add event listener for the select all checkbox
  const selectAllCheckbox = document.getElementById('selectAllPodcastsCheckbox');
  selectAllCheckbox.addEventListener('change', toggleSelectAllPodcasts);
  
  // For each podcast, create a card
  podcasts.forEach(podcast => {
    const card = createPodcastCard(podcast);
    container.appendChild(card);
  });
}

/**
 * Create a podcast card element
 * @param {Object} podcast - Podcast object
 * @returns {HTMLElement} Podcast card element
 */
function createPodcastCard(podcast) {
  const card = document.createElement('div');
  card.className = 'podcast-card';
  
  // Format date
  const date = new Date(podcast.dateCreated);
  const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  
  // Get article titles if available
  let articlesList = '';
  if (podcast.articleIds && podcast.articleIds.length > 0) {
    const articleTitles = [];
    
    for (const articleId of podcast.articleIds) {
      const article = allArticles.find(a => a.id === articleId);
      if (article) {
        articleTitles.push(article.title || 'Untitled Article');
      }
    }
    
    if (articleTitles.length > 0) {
      articlesList = `
        <div class="podcast-articles">
          <h4>Articles</h4>
          ${articleTitles.map(title => `<div class="article-title">${title}</div>`).join('')}
        </div>
      `;
    }
  }
  
  // Get host names from the podcast settings
  const hostName = podcast.settings?.hostNames?.['HOST'] || 'Host';
  const cohostName = podcast.settings?.hostNames?.['CO-HOST'] || 'Co-Host';
  
  // Speaker info
  const speakerInfo = `
    <div class="speaker-info">
      Host: ${hostName} | Co-Host: ${cohostName}
    </div>
  `;
  
  card.innerHTML = `
    <div class="podcast-header">
      <div style="display: flex; align-items: center;">
        <label class="checkbox-container" style="margin-right: 12px;">
          <input type="checkbox" class="podcast-checkbox" data-id="${podcast.id}" ${selectedPodcasts.has(podcast.id) ? 'checked' : ''}>
          <span class="checkmark"></span>
        </label>
        <h3 class="podcast-title">${podcast.title || 'Untitled Podcast'}</h3>
      </div>
    </div>
    <div class="podcast-body">
      <div class="podcast-info">
        Created: ${formattedDate}
      </div>
      <audio class="audio-player" controls></audio>
      ${speakerInfo}
      ${articlesList}
      <div class="podcast-actions" style="margin-top: 15px;">
        <button class="btn btn-secondary view-script-btn">View Script</button>
        <button class="btn btn-primary download-btn">Download</button>
      </div>
    </div>
  `;
  
  // Set up audio player
  const audioPlayer = card.querySelector('.audio-player');
  getAudioById(podcast.id).then(audio => {
    if (audio && audio.blob) {
      const audioUrl = URL.createObjectURL(audio.blob);
      audioPlayer.src = audioUrl;
    }
  });
  
  // Set up selection
  const checkbox = card.querySelector('.podcast-checkbox');
  checkbox.addEventListener('change', (e) => {
    togglePodcastSelection(podcast.id, e.target.checked);
  });
  
  // Set up view script button
  const viewScriptBtn = card.querySelector('.view-script-btn');
  viewScriptBtn.addEventListener('click', () => {
    // Create modal for script display
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    
    // Color-code the script based on speaker
    const coloredScript = (podcast.script || 'No script available')
      .split('\n')
      .map(line => {
        // Get the first word before the colon (the speaker name)
        const speaker = line.split(':')[0];
        
        // Replace HOST/CO-HOST with actual names if present
        let processedLine = line;
        if (line.startsWith('HOST:')) {
          processedLine = line.replace('HOST:', `${hostName}:`);
        } else if (line.startsWith('CO-HOST:')) {
          processedLine = line.replace('CO-HOST:', `${cohostName}:`);
        }
        
        // Color based on the speaker name
        if (speaker === hostName || speaker === 'HOST') {
          return `<span style="color: #2563eb;">${processedLine}</span>`;
        } else if (speaker === cohostName || speaker === 'CO-HOST') {
          return `<span style="color: #dc2626;">${processedLine}</span>`;
        }
        return processedLine;
      })
      .join('\n');
    
    modal.innerHTML = `
      <div class="modal-content" style="width: 80%; max-width: 800px;">
        <div class="modal-header">
          <h2>Podcast Script</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
          <pre style="white-space: pre-wrap; padding: 10px; background: #f8f9fa; border-radius: 6px; line-height: 1.6;">${coloredScript}</pre>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Set up close button
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    // Close when clicking outside the content
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    });
  });
  
  // Set up download button
  const downloadBtn = card.querySelector('.download-btn');
  downloadBtn.addEventListener('click', () => {
    getAudioById(podcast.id).then(audio => {
      if (audio && audio.blob) {
        const url = URL.createObjectURL(audio.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${podcast.title || 'podcast'}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    }).catch(error => {
      console.error('Error downloading podcast:', error);
      showStatus(`Error downloading podcast: ${error.message}`, 'error');
    });
  });
  
  return card;
}

/**
 * Toggle selection of a podcast
 * @param {number} podcastId - Podcast ID
 * @param {boolean} selected - Whether the podcast is selected
 */
function togglePodcastSelection(podcastId, selected) {
  if (selected) {
    selectedPodcasts.add(podcastId);
  } else {
    selectedPodcasts.delete(podcastId);
  }
  
  updatePodcastButtonsState();
}

/**
 * Toggle selection of all podcasts
 * @param {Event} event - Change event
 */
function toggleSelectAllPodcasts(event) {
  const isChecked = event.target.checked;
  
  // Update all checkboxes
  document.querySelectorAll('.podcast-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
    togglePodcastSelection(parseInt(checkbox.dataset.id), isChecked);
  });
  
  updatePodcastButtonsState();
}

/**
 * Update the state of podcast action buttons based on selection
 */
function updatePodcastButtonsState() {
  const hasSelection = selectedPodcasts.size > 0;
  
  // Update the main delete button in the header
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = !hasSelection;
  }
}

/**
 * Delete all selected podcasts
 */
async function deleteSelectedPodcasts() {
  if (selectedPodcasts.size === 0) return;
  
  const confirmMessage = selectedPodcasts.size === 1
    ? 'Are you sure you want to delete the selected podcast?'
    : `Are you sure you want to delete ${selectedPodcasts.size} selected podcasts?`;
  
  if (!confirm(confirmMessage)) return;
  
  try {
    const deletePromises = Array.from(selectedPodcasts).map(id => deletePodcast(id));
    await Promise.all(deletePromises);
    
    // Update arrays
    allPodcasts = allPodcasts.filter(podcast => !selectedPodcasts.has(podcast.id));
    
    // Clear selection
    selectedPodcasts.clear();
    
    // Update UI
    displayPodcasts(allPodcasts);
    
    showStatus('Selected podcasts deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting podcasts:', error);
    showStatus(`Error deleting podcasts: ${error.message}`, 'error');
  }
}

/**
 * Delete a podcast by ID
 * @param {number} podcastId - Podcast ID
 * @returns {Promise<void>}
 */
async function deletePodcast(podcastId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      reject(new Error("Failed to open database."));
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["audio"], "readwrite");
      const store = transaction.objectStore("audio");
      const deleteRequest = store.delete(podcastId);
      
      deleteRequest.onsuccess = () => {
        resolve();
      };
      
      deleteRequest.onerror = () => {
        reject(new Error("Failed to delete podcast."));
      };
    };
  });
}

/**
 * Toggle expanding/collapsing all articles
 */
function toggleAllArticles() {
  const toggleAllBtn = document.getElementById('toggleAllBtn');
  const toggleAllIcon = document.getElementById('toggleAllIcon');
  const toggleAllText = document.getElementById('toggleAllText');
  const articleCards = document.querySelectorAll('.article-card');
  
  // Determine if we're expanding or collapsing
  // Base this on the current button text
  const isExpanding = toggleAllText.textContent.includes('Expand');
  
  // Update all cards
  articleCards.forEach(card => {
    const articleId = parseInt(card.dataset.id);
    const fullContent = card.querySelector('.card-full-content');
    const toggleIcon = card.querySelector('.toggle-icon');
    const toggleText = card.querySelector('.toggle-text');
    
    if (isExpanding) {
      // Expand this card
      fullContent.style.display = 'block';
      toggleIcon.textContent = '▲';
      toggleText.textContent = 'Hide Full Article';
      expandedArticles.add(articleId);
    } else {
      // Collapse this card
      fullContent.style.display = 'none';
      toggleIcon.textContent = '▼';
      toggleText.textContent = 'Show Full Article';
      expandedArticles.delete(articleId);
    }
  });
  
  // Update the toggle all button
  if (isExpanding) {
    toggleAllIcon.textContent = '▲';
    toggleAllText.textContent = 'Collapse All';
  } else {
    toggleAllIcon.textContent = '▼';
    toggleAllText.textContent = 'Expand All';
  }
}

// Fallback implementations if imports fail
function safeEstimateAudioDuration(sizeInBytes) {
  if (typeof estimateAudioDuration === 'function') {
    return estimateAudioDuration(sizeInBytes);
  }
  // Fallback implementation: MP3 at ~128 kbps is about 16 KB per second
  return Math.round(sizeInBytes / (16 * 1024));
}

function safeFormatDuration(seconds) {
  if (typeof formatDuration === 'function') {
    return formatDuration(seconds);
  }
  // Fallback implementation
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Initialize event listeners
 */
function initializeEventListeners() {
  // Tab view buttons
  const viewArticlesBtn = document.getElementById('viewArticlesBtn');
  if (viewArticlesBtn) {
    viewArticlesBtn.addEventListener('click', () => switchView('articles'));
  }
  
  const viewPodcastsBtn = document.getElementById('viewPodcastsBtn');
  if (viewPodcastsBtn) {
    viewPodcastsBtn.addEventListener('click', () => switchView('podcasts'));
  }
  
  // Search functionality
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => searchArticles(e.target.value));
    searchInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        const query = searchInput.value.trim();
        searchArticles(query);
      }
    });
  }
  
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const query = document.getElementById('searchInput')?.value.trim() || '';
      searchArticles(query);
    });
  }
  
  // Action buttons
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', deleteSelectedArticles);
  }
  
  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  if (exportSelectedBtn) {
    exportSelectedBtn.addEventListener('click', exportSelectedArticles);
  }
  
  const generatePodcastBtn = document.getElementById('generatePodcastBtn');
  if (generatePodcastBtn) {
    generatePodcastBtn.addEventListener('click', openGeneratePodcastModal);
  }
  
  // Generate podcast modal
  const modalClose = document.querySelector('#generatePodcastModal .modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', closeGeneratePodcastModal);
  }
  
  const cancelGenerateBtn = document.getElementById('cancelGenerateBtn');
  if (cancelGenerateBtn) {
    cancelGenerateBtn.addEventListener('click', closeGeneratePodcastModal);
  }
  
  const startGenerateBtn = document.getElementById('startGenerateBtn');
  if (startGenerateBtn) {
    startGenerateBtn.addEventListener('click', startPodcastGeneration);
  }
  
  const downloadPodcastBtn = document.getElementById('downloadPodcastBtn');
  if (downloadPodcastBtn) {
    downloadPodcastBtn.addEventListener('click', downloadPodcast);
  }
  
  const scriptToggle = document.getElementById('scriptToggle');
  if (scriptToggle) {
    scriptToggle.addEventListener('click', toggleScript);
  }
  
  // Voice preview buttons
  const previewHostVoiceBtn = document.getElementById('previewHostVoice');
  if (previewHostVoiceBtn) {
    previewHostVoiceBtn.addEventListener('click', previewHostVoice);
  }
  
  const previewCohostVoiceBtn = document.getElementById('previewCohostVoice');
  if (previewCohostVoiceBtn) {
    previewCohostVoiceBtn.addEventListener('click', previewCohostVoice);
  }
  
  // Select all checkbox
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', toggleSelectAll);
  }
  
  // Toggle all articles/podcasts
  const toggleAllBtn = document.getElementById('toggleAllBtn');
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', toggleAllArticles);
  }
  
  // Date filter
  const applyDateFilterBtn = document.getElementById('applyDateFilterBtn');
  if (applyDateFilterBtn) {
    applyDateFilterBtn.addEventListener('click', applyDateFilter);
  }
  
  const resetDateFilterBtn = document.getElementById('resetDateFilterBtn');
  if (resetDateFilterBtn) {
    resetDateFilterBtn.addEventListener('click', resetDateFilter);
  }
  
  // Quick date filters
  const todayFilterBtn = document.getElementById('todayFilterBtn');
  if (todayFilterBtn) {
    todayFilterBtn.addEventListener('click', () => applyQuickDateFilter('today'));
  }
  
  const weekFilterBtn = document.getElementById('weekFilterBtn');
  if (weekFilterBtn) {
    weekFilterBtn.addEventListener('click', () => applyQuickDateFilter('week'));
  }
  
  const monthFilterBtn = document.getElementById('monthFilterBtn');
  if (monthFilterBtn) {
    monthFilterBtn.addEventListener('click', () => applyQuickDateFilter('month'));
  }
  
  const yearFilterBtn = document.getElementById('yearFilterBtn');
  if (yearFilterBtn) {
    yearFilterBtn.addEventListener('click', () => applyQuickDateFilter('year'));
  }
  
  // Voice selection change handlers
  const hostVoiceSelect = document.getElementById('hostVoiceSelect');
  const cohostVoiceSelect = document.getElementById('cohostVoiceSelect');
  
  if (hostVoiceSelect) {
    hostVoiceSelect.addEventListener('change', () => {
      updateVoiceLabels();
      validateVoiceSelections();
    });
  }
  
  if (cohostVoiceSelect) {
    cohostVoiceSelect.addEventListener('change', () => {
      updateVoiceLabels();
      validateVoiceSelections();
    });
  }
  
  // Initial update of voice labels
  updateVoiceLabels();
}

/**
 * Preview the host voice
 */
async function previewHostVoice() {
  const voice = document.getElementById('hostVoiceSelect').value;
  await playVoicePreview(voice);
}

/**
 * Preview the co-host voice
 */
async function previewCohostVoice() {
  const voice = document.getElementById('cohostVoiceSelect').value;
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
      throw new Error('OpenAI API key not set. Please go to settings and add your API key.');
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
    const previewButtons = document.querySelectorAll('#previewHostVoice, #previewCohostVoice');
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
    const previewButtons = document.querySelectorAll('#previewHostVoice, #previewCohostVoice');
    previewButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = 'Preview Voice';
    });
  }
}

/**
 * Toggle the script visibility
 */
function toggleScript() {
  const scriptElement = document.getElementById('podcastScript');
  const toggleButton = document.getElementById('scriptToggle');
  
  if (scriptElement.style.display === 'none') {
    scriptElement.style.display = 'block';
    toggleButton.textContent = 'Hide Script';
  } else {
    scriptElement.style.display = 'none';
    toggleButton.textContent = 'Show Script';
  }
}

/**
 * Update the voice selection labels to show the corresponding names
 */
function updateVoiceLabels() {
  const voiceNameMap = {
    'alloy': 'Esha',
    'echo': 'Hari',
    'fable': 'Mira',
    'onyx': 'Tej',
    'nova': 'Leela',
    'shimmer': 'Veena'
  };
  
  const hostVoiceSelect = document.getElementById('hostVoiceSelect');
  const cohostVoiceSelect = document.getElementById('cohostVoiceSelect');
  const hostLabel = document.querySelector('label[for="hostVoiceSelect"]');
  const cohostLabel = document.querySelector('label[for="cohostVoiceSelect"]');
  
  // Update the dropdown options to show only the mapped names
  if (hostVoiceSelect) {
    const currentValue = hostVoiceSelect.value;
    hostVoiceSelect.innerHTML = Object.entries(voiceNameMap)
      .map(([value, name]) => `<option value="${value}">${name}</option>`)
      .join('');
    hostVoiceSelect.value = currentValue;
  }
  
  if (cohostVoiceSelect) {
    const currentValue = cohostVoiceSelect.value;
    cohostVoiceSelect.innerHTML = Object.entries(voiceNameMap)
      .map(([value, name]) => `<option value="${value}">${name}</option>`)
      .join('');
    cohostVoiceSelect.value = currentValue;
  }
  
  // Update labels to be simple "Host Voice" and "Co-Host Voice"
  if (hostLabel) {
    hostLabel.textContent = 'Host Voice';
  }
  
  if (cohostLabel) {
    cohostLabel.textContent = 'Co-Host Voice';
  }
}
