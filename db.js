/**
 * IndexedDB Service for Article to Audio Extension (Local Version)
 * Handles all database operations for storing articles, audio files, and metadata locally
 */

// Database constants
const DB_NAME = "ArticleToAudioDB";
const DB_VERSION = 2;
const STORES = {
  ARTICLES: "articles",
  AUDIO: "audio",
  SETTINGS: "settings"
};

/**
 * Initialize the database
 * @returns {Promise} Promise that resolves when the database is ready
 */
function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("Database error:", event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      console.log("Database opened successfully");
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      console.log(`Database upgrade needed from version ${oldVersion} to ${DB_VERSION}`);

      // Initial database setup (version 0 to 1)
      if (oldVersion < 1) {
        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.ARTICLES)) {
          const articlesStore = db.createObjectStore(STORES.ARTICLES, { keyPath: "id", autoIncrement: true });
          articlesStore.createIndex("url", "url", { unique: true }); // Still creating with unique initially
          articlesStore.createIndex("title", "title", { unique: false });
          articlesStore.createIndex("dateAdded", "dateAdded", { unique: false });
          console.log("Articles store created");
        }

        if (!db.objectStoreNames.contains(STORES.AUDIO)) {
          const audioStore = db.createObjectStore(STORES.AUDIO, { keyPath: "id", autoIncrement: true });
          audioStore.createIndex("articleId", "articleId", { unique: false });
          audioStore.createIndex("type", "type", { unique: false });
          audioStore.createIndex("dateCreated", "dateCreated", { unique: false });
          console.log("Audio store created");
        }

        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          const settingsStore = db.createObjectStore(STORES.SETTINGS, { keyPath: "key" });
          console.log("Settings store created");
        }
      }
      
      // Update from version 1 to 2 - Remove URL uniqueness constraint
      if (oldVersion < 2) {
        console.log("Upgrading to version 2: Removing URL uniqueness constraint");
        
        // We need to recreate the index
        if (db.objectStoreNames.contains(STORES.ARTICLES)) {
          const articlesStore = event.target.transaction.objectStore(STORES.ARTICLES);
          
          // Delete the old index
          if (articlesStore.indexNames.contains("url")) {
            articlesStore.deleteIndex("url");
          }
          
          // Create a new index without uniqueness constraint
          articlesStore.createIndex("url", "url", { unique: false });
          console.log("URL index updated to non-unique");
        }
      }
    };
  });
}

/**
 * Get a connection to the database
 * @returns {Promise<IDBDatabase>} Database connection
 */
async function getDBConnection() {
  return await initializeDB();
}

/**
 * Save an article to the database
 * @param {Object} article - Article object with title, content, url, etc.
 * @returns {Promise<number>} ID of the saved article
 */
async function saveArticle(article) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.ARTICLES], "readwrite");
    const store = transaction.objectStore(STORES.ARTICLES);
    
    // Add timestamp if not present
    if (!article.dateAdded) {
      article.dateAdded = new Date().toISOString();
    }
    
    // Make sure URL is present (can be null/empty but should exist)
    if (!article.hasOwnProperty('url')) {
      article.url = null;
    }
    
    const request = store.add(article);
    
    request.onsuccess = (event) => {
      console.log("Article saved successfully with ID:", event.target.result);
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error saving article:", event.target.error);
      
      // If we still get a uniqueness error (in case the user hasn't refreshed since the schema update),
      // we'll generate a unique URL by adding a timestamp
      if (event.target.error.name === 'ConstraintError') {
        console.log("Attempting to save with a modified URL to avoid uniqueness constraints");
        
        // Create a modified URL to avoid the uniqueness constraint
        const timestamp = new Date().getTime();
        if (article.url) {
          article.url = `${article.url}#${timestamp}`;
        } else {
          article.url = `generated-url-${timestamp}`;
        }
        
        // Try again with the modified URL
        const retryRequest = store.add(article);
        
        retryRequest.onsuccess = (event) => {
          console.log("Article saved with modified URL, ID:", event.target.result);
          resolve(event.target.result);
        };
        
        retryRequest.onerror = (event) => {
          console.error("Failed to save article with modified URL:", event.target.error);
          reject(event.target.error);
        };
      } else {
        reject(event.target.error);
      }
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Update an existing article in the database
 * @param {Object} article - Article object with id and updated properties
 * @returns {Promise<boolean>} Whether the update was successful
 */
async function updateArticle(article) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.ARTICLES], "readwrite");
    const store = transaction.objectStore(STORES.ARTICLES);
    
    // Add update timestamp
    article.dateUpdated = new Date().toISOString();
    
    const request = store.put(article);
    
    request.onsuccess = () => {
      console.log("Article updated successfully");
      resolve(true);
    };
    
    request.onerror = (event) => {
      console.error("Error updating article:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all articles from the database
 * @returns {Promise<Array>} Array of article objects
 */
async function getAllArticles() {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.ARTICLES], "readonly");
    const store = transaction.objectStore(STORES.ARTICLES);
    const request = store.getAll();
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error getting articles:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get an article by its ID
 * @param {number} id - Article ID
 * @returns {Promise<Object>} Article object
 */
async function getArticleById(id) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.ARTICLES], "readonly");
    const store = transaction.objectStore(STORES.ARTICLES);
    const request = store.get(id);
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error getting article:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete an article and its associated audio files
 * @param {number} id - Article ID
 * @returns {Promise<boolean>} Whether the deletion was successful
 */
async function deleteArticle(id) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    // First delete the article
    const articleTransaction = db.transaction([STORES.ARTICLES], "readwrite");
    const articleStore = articleTransaction.objectStore(STORES.ARTICLES);
    const articleRequest = articleStore.delete(id);
    
    articleRequest.onsuccess = async () => {
      // Then delete any associated audio files
      try {
        await deleteAudioForArticle(id);
        resolve(true);
      } catch (error) {
        console.error("Error deleting associated audio:", error);
        reject(error);
      }
    };
    
    articleRequest.onerror = (event) => {
      console.error("Error deleting article:", event.target.error);
      reject(event.target.error);
    };
    
    articleTransaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Save an audio file to the database
 * @param {Object} audio - Audio object with articleId, blob, type, etc.
 * @returns {Promise<number>} ID of the saved audio entry
 */
async function saveAudio(audio) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDIO], "readwrite");
    const store = transaction.objectStore(STORES.AUDIO);
    
    // Add timestamp if not present
    if (!audio.dateCreated) {
      audio.dateCreated = new Date().toISOString();
    }
    
    const request = store.add(audio);
    
    request.onsuccess = (event) => {
      console.log("Audio saved successfully with ID:", event.target.result);
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error saving audio:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all audio files for an article
 * @param {number} articleId - Article ID
 * @returns {Promise<Array>} Array of audio objects
 */
async function getAudioForArticle(articleId) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDIO], "readonly");
    const store = transaction.objectStore(STORES.AUDIO);
    const index = store.index("articleId");
    const request = index.getAll(articleId);
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error getting audio:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get an audio file by its ID
 * @param {number} id - Audio ID
 * @returns {Promise<Object>} Audio object with blob data
 */
async function getAudioById(id) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDIO], "readonly");
    const store = transaction.objectStore(STORES.AUDIO);
    const request = store.get(id);
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      console.error("Error getting audio:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete all audio files associated with an article
 * @param {number} articleId - Article ID
 * @returns {Promise<boolean>} Whether the deletion was successful
 */
async function deleteAudioForArticle(articleId) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDIO], "readwrite");
    const store = transaction.objectStore(STORES.AUDIO);
    const index = store.index("articleId");
    const request = index.getAllKeys(articleId);
    
    request.onsuccess = (event) => {
      const keys = event.target.result;
      
      if (keys.length === 0) {
        resolve(true);
        return;
      }
      
      let deletedCount = 0;
      
      keys.forEach((key) => {
        const deleteRequest = store.delete(key);
        
        deleteRequest.onsuccess = () => {
          deletedCount++;
          
          if (deletedCount === keys.length) {
            resolve(true);
          }
        };
        
        deleteRequest.onerror = (event) => {
          console.error("Error deleting audio:", event.target.error);
          reject(event.target.error);
        };
      });
    };
    
    request.onerror = (event) => {
      console.error("Error getting audio keys:", event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Save a setting in the database
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 * @returns {Promise<boolean>} Whether the save was successful
 */
async function saveSetting(key, value) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SETTINGS], "readwrite");
    const store = transaction.objectStore(STORES.SETTINGS);
    
    const request = store.put({ key, value });
    
    request.onsuccess = () => {
      console.log(`Setting "${key}" saved successfully`);
      resolve(true);
    };
    
    request.onerror = (event) => {
      console.error(`Error saving setting "${key}":`, event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get a setting from the database
 * @param {string} key - Setting key
 * @returns {Promise<*>} Setting value
 */
async function getSetting(key) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SETTINGS], "readonly");
    const store = transaction.objectStore(STORES.SETTINGS);
    const request = store.get(key);
    
    request.onsuccess = (event) => {
      const result = event.target.result;
      resolve(result ? result.value : null);
    };
    
    request.onerror = (event) => {
      console.error(`Error getting setting "${key}":`, event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete a setting from the database
 * @param {string} key - Setting key
 * @returns {Promise<boolean>} Whether the deletion was successful
 */
async function deleteSetting(key) {
  const db = await getDBConnection();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.SETTINGS], "readwrite");
    const store = transaction.objectStore(STORES.SETTINGS);
    
    const request = store.delete(key);
    
    request.onsuccess = () => {
      console.log(`Setting "${key}" deleted successfully`);
      resolve(true);
    };
    
    request.onerror = (event) => {
      console.error(`Error deleting setting "${key}":`, event.target.error);
      reject(event.target.error);
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Export all database data
 * @returns {Promise<Object>} Database data
 */
async function exportDatabase() {
  try {
    const articles = await getAllArticles();
    
    // Get all audio files
    const audioData = [];
    for (const article of articles) {
      const audioFiles = await getAudioForArticle(article.id);
      audioData.push(...audioFiles);
    }
    
    // Get all settings
    const db = await getDBConnection();
    const settingsData = await new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.SETTINGS], "readonly");
      const store = transaction.objectStore(STORES.SETTINGS);
      const request = store.getAll();
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        console.error("Error getting settings:", event.target.error);
        reject(event.target.error);
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
    
    return {
      articles,
      audio: audioData,
      settings: settingsData
    };
  } catch (error) {
    console.error("Error exporting database:", error);
    throw error;
  }
}

/**
 * Import data into the database
 * @param {Object} data - Database data
 * @returns {Promise<boolean>} Whether the import was successful
 */
async function importDatabase(data) {
  const db = await getDBConnection();
  
  try {
    // Import articles
    if (data.articles && Array.isArray(data.articles)) {
      for (const article of data.articles) {
        await saveArticle(article);
      }
    }
    
    // Import audio
    if (data.audio && Array.isArray(data.audio)) {
      for (const audio of data.audio) {
        await saveAudio(audio);
      }
    }
    
    // Import settings
    if (data.settings && Array.isArray(data.settings)) {
      for (const setting of data.settings) {
        await saveSetting(setting.key, setting.value);
      }
    }
    
    return true;
  } catch (error) {
    console.error("Error importing database:", error);
    throw error;
  }
}

/**
 * Get database usage statistics
 * @returns {Promise<Object>} Database usage statistics
 */
async function getDatabaseStats() {
  try {
    const articles = await getAllArticles();
    
    // First, get audio files linked to articles
    let articleLinkedAudioCount = 0;
    let articleLinkedAudioSize = 0;
    
    for (const article of articles) {
      const audioFiles = await getAudioForArticle(article.id);
      articleLinkedAudioCount += audioFiles.length;
      
      for (const audio of audioFiles) {
        if (audio.blob) {
          articleLinkedAudioSize += audio.blob.size;
        }
      }
    }
    
    // Now get all audio files including podcasts (which might not be linked to articles)
    const db = await getDBConnection();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORES.AUDIO], "readonly");
      const store = transaction.objectStore(STORES.AUDIO);
      const request = store.getAll();
      
      request.onsuccess = (event) => {
        const allAudioFiles = event.target.result;
        let totalAudioSize = 0;
        let audioCount = allAudioFiles.length;
        
        // Calculate total size
        for (const audio of allAudioFiles) {
          if (audio.blob) {
            totalAudioSize += audio.blob.size;
          }
        }
        
        resolve({
          articleCount: articles.length,
          audioCount,
          totalAudioSize
        });
      };
      
      request.onerror = (event) => {
        console.error("Error getting all audio files:", event.target.error);
        // Fallback to just article-linked audio if we can't get all
        resolve({
          articleCount: articles.length,
          audioCount: articleLinkedAudioCount,
          totalAudioSize: articleLinkedAudioSize
        });
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("Error getting database stats:", error);
    throw error;
  }
}

// Export all functions and constants
export {
  initializeDB,
  saveArticle,
  updateArticle,
  getAllArticles,
  getArticleById,
  deleteArticle,
  saveAudio,
  getAudioForArticle,
  getAudioById,
  deleteAudioForArticle,
  saveSetting,
  getSetting,
  deleteSetting,
  exportDatabase,
  importDatabase,
  getDatabaseStats,
  DB_NAME,
  DB_VERSION
}; 