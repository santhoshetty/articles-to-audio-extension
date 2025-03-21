console.log("📰 Article Extractor Initialized");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message received in content script:", request);
    if (request.action === "EXTRACT_ARTICLE") {
        extractArticle().then(articleData => {
            console.log("Extracted article data:", articleData);
            sendResponse(articleData);
        });
        return true;
    }
});

async function extractArticle() {
    /**
     * Extract text from element, removing unwanted elements
     */
    function getTextFromElement(element) {
        if (!element) return "";
        // Remove unwanted elements
        const clone = element.cloneNode(true);
        const unwanted = clone.querySelectorAll('script, style, nav, header, footer, .ad, .advertisement');
        unwanted.forEach(el => el.remove());
        return clone.innerText.trim();
    }

    /**
     * Check iframes for content
     */
    function getTextFromIframes() {
        let iframeTexts = [];
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                // Skip known cross-origin iframes
                const src = iframe.getAttribute('src');
                if (src && src.includes("disqus.com")) {
                    console.warn("Skipping Disqus iframe due to cross-origin restrictions.");
                    return; // Skip this iframe
                }

                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc) {
                    // Try specific selectors first
                    const articleElement = doc.querySelector('.article-list-article, article, .article-content');
                    if (articleElement) {
                        iframeTexts.push(getTextFromElement(articleElement));
                    } else {
                        // Fallback to body content if no specific article element found
                        const bodyText = getTextFromElement(doc.body);
                        if (bodyText.length > 100) { // Only include if substantial content
                            iframeTexts.push(bodyText);
                        }
                    }
                }
            } catch (e) {
                console.warn("Could not access iframe:", e);
            }
        });
        return iframeTexts.join("\n\n");
    }

    // Article selectors in order of preference
    const articleSelectors = [
        '.article-list-article',
        'article',
        '.article-content',
        '.story-content',
        'div[class*="article"]',
        'div[class*="story"]',
        '.entry-content',
        'main',
        'div[role="main"]'
    ];

    let mainContent = "";
    
    // Try main page first
    for (const selector of articleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            mainContent = getTextFromElement(element);
            console.log(`Found content using selector: ${selector}, Content Length: ${mainContent.length}`);
            if (mainContent.length > 100) { // Found substantial content
                console.log(`Valid content found: ${mainContent.slice(0, 200)}...`);
                break;
            }
        } else {
            console.log(`No content found for selector: ${selector}`);
        }
    }

    // Check iframes if main content is not found or too short
    if (!mainContent || mainContent.length < 100) {
        console.log("Checking iframes for content...");
        mainContent = getTextFromIframes();
        console.log(`Iframes content length: ${mainContent.length}`);
    }

    if (!mainContent.trim()) {
        throw new Error("No article content found. Please make sure you're on an article page.");
    }

    console.log("Content extraction stats:", {
        totalLength: mainContent.length,
        preview: mainContent.slice(0, 200) + '...',
        estimatedTokens: Math.ceil(mainContent.length / 4)
    });

    return {
        title: document.title,
        text: mainContent
    };
} 