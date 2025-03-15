// test.js - Debug script for Article to Audio Extension

// Import database functions
import { 
  initializeDB, 
  getAllArticles, 
  saveArticle, 
  deleteArticle 
} from './db.js';

// Test function to check if IndexedDB is working
async function testIndexedDB() {
  console.log('Testing IndexedDB...');
  
  try {
    // Initialize the database
    await initializeDB();
    console.log('Database initialized successfully');
    
    // Get all articles
    const articles = await getAllArticles();
    console.log('Current articles in database:', articles.length);
    console.log('Articles:', articles);
    
    // Test saving an article
    const testArticle = {
      title: 'Test Article ' + new Date().toISOString(),
      content: 'This is a test article content. It should be saved to IndexedDB.',
      summary: 'Test summary',
      url: 'https://example.com/test',
      dateAdded: new Date().toISOString()
    };
    
    const articleId = await saveArticle(testArticle);
    console.log('Test article saved with ID:', articleId);
    
    // Get all articles again to verify
    const updatedArticles = await getAllArticles();
    console.log('Updated articles count:', updatedArticles.length);
    
    // Find the test article
    const savedArticle = updatedArticles.find(a => a.id === articleId);
    console.log('Saved test article:', savedArticle);
    
    return {
      success: true,
      message: 'IndexedDB test completed successfully',
      articleId
    };
  } catch (error) {
    console.error('Error testing IndexedDB:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test
testIndexedDB().then(result => {
  console.log('Test result:', result);
}).catch(error => {
  console.error('Test failed:', error);
}); 