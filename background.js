// background.js

chrome.runtime.onInstalled.addListener(() => {
    console.log("Article Saver extension installed");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SAVE_ARTICLE") {
        handleSaveArticle(request.payload)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
});

async function handleSaveArticle(articleData) {
    try {
        // Get existing articles
        const storage = await chrome.storage.local.get(['articles']);
        const articles = storage.articles || [];

        // Add new article
        articles.push({
            title: articleData.title,
            text: articleData.text,
            date: articleData.date
        });

        // Save back to storage
        await chrome.storage.local.set({ articles });
        
        console.log("Article saved successfully:", articleData.title);
        return { success: true };
    } catch (error) {
        console.error("Error saving article:", error);
        throw error;
    }
} 