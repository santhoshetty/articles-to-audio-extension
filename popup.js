// popup.js

async function summarizeText(text) {
    // Get API key from storage
    const storage = await chrome.storage.local.get(['openaiKey']);
    if (!storage.openaiKey) {
        throw new Error("OpenAI API key not found. Please set it in the extension options.");
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${storage.openaiKey}`  // Use key from storage
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{
                    role: 'system',
                    content: 'Summarize the following article in a concise way:'
                }, {
                    role: 'user',
                    content: text
                }],
                max_tokens: 300
            })
        });
        
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Summarization failed:', error);
        throw error;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const saveArticleBtn = document.getElementById("saveArticleBtn");
    const showArticlesBtn = document.getElementById("showArticlesBtn");
    const statusMessage = document.getElementById("statusMessage");

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 3000);
    }

    if (!saveArticleBtn || !showArticlesBtn) {
        console.error("Buttons not found!");
        return;
    }

    saveArticleBtn.addEventListener("click", async () => {
        try {
            console.log("Save button clicked");
            saveArticleBtn.disabled = true;
            saveArticleBtn.innerHTML = '<span class="icon">⏳</span>Saving...';
            
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                showStatus("No active tab found", "error");
                return;
            }
            console.log("Current tab:", tab.id);

            // 2. Ensure content script is injected
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['contentScript.js']
                });
                console.log("Content script injected");
            } catch (err) {
                console.log("Content script already exists or injection failed:", err);
            }

            // 3. Extract article content
            const articleData = await chrome.tabs.sendMessage(tab.id, { 
                action: "EXTRACT_ARTICLE" 
            }).catch(err => {
                console.error("Failed to send message to content script:", err);
                throw new Error("Failed to extract article. Make sure you're on an article page.");
            });

            console.log("Extracted article data:", articleData);

            if (!articleData || !articleData.text) {
                alert("No article text found. Make sure you're on an article page.");
                return;
            }

            // 4. Save the article
            const response = await chrome.runtime.sendMessage({
                action: "SAVE_ARTICLE",
                payload: {
                    title: articleData.title,
                    text: articleData.text,
                    date: new Date().toISOString()
                }
            });

            if (response?.success) {
                showStatus("Article saved successfully!", "success");
            } else {
                showStatus("Failed to save the article.", "error");
            }
        } catch (error) {
            console.error("Error in save article flow:", error);
            showStatus(error.message || "Failed to process the article.", "error");
        } finally {
            saveArticleBtn.disabled = false;
            saveArticleBtn.innerHTML = '<span class="icon">📝</span>Save This Article';
        }
    });

    showArticlesBtn.addEventListener("click", async () => {
        const articlesPageUrl = chrome.runtime.getURL("articles.html");
        await chrome.tabs.create({ url: articlesPageUrl });
        window.close();
    });

    document.getElementById('optionsLink').addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    // Check if API key exists
    const storage = await chrome.storage.local.get(['openaiKey']);
    if (!storage.openaiKey) {
        alert('Please set your OpenAI API key in the extension settings first.');
        chrome.runtime.openOptionsPage();
        return;
    }
});
