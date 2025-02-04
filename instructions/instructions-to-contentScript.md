The **example.html** file is a saved version of the **ePaper page of The Hindu** newspaper. The structure of this file provides important insights into how the webpage is built, which can help in designing a **contentScript.js** to extract articles effectively.

---

### **1. Key Observations from the HTML Structure**
- **Saved via SingleFile**:  
  The comment at the top suggests that this HTML file was saved using the **SingleFile** Chrome extension. This means some inline elements or dynamically loaded content might not be exactly as they are in the live version.

- **Metadata Section (Head)**
  - Contains `<meta>` tags for **charset, viewport settings, and page description.**
  - **Google site verification** and **viewport settings** are present.

- **Heavy Use of Embedded Fonts**
  - Multiple `<style>` blocks contain `@font-face` rules defining **custom fonts** like "Fira Sans."
  - Font files are embedded as **Base64-encoded** data (`src: url(data:font/woff2;base64,...)`).

---

### **2. Understanding the Article Extraction Challenge**
Since **The Hindu ePaper is a dynamically loaded, JavaScript-heavy page**, some important points emerge:

✅ **Dynamic Content**:  
- The newspaper articles **might not be in the initial HTML source** but could be loaded dynamically using JavaScript.  
- This means a simple DOM parsing (`document.querySelector("article")`) **might not work** directly.  

✅ **Articles Are Likely in `<div>` Containers**
- Unlike traditional news websites where articles are wrapped inside `<article>` elements, here they may be in **`<div>` elements inside an iframe or dynamically loaded sections**.

✅ **Login Dependency**
- Since the ePaper is behind a **Google-based login**, the extracted HTML **does not contain logged-in content** unless saved after login.

✅ **Hamburger Menu Navigation**
- The articles are likely accessible via a **menu button (hamburger icon) that expands a list of sections**.  
- The **Editorial section** will have to be **selected manually or through scripting**.

---

### **3. What Sections to Target for Article Extraction?**
Based on typical newspaper ePaper structures:
1. **Main Articles**
   - Inside dynamically loaded `<div>` or `<section>` elements.
   - Look for **distinct class names** (e.g., `"article-title"` or `"article-content"`).
   - Could be inside an **iframe**.

2. **Editorial Section**
   - Usually accessed through a **hamburger menu** or **sidebar navigation**.
   - Need to **click the "Editorial" button** before extracting.

3. **Title & Content Extraction**
   - Article **titles** are often inside `<h1>` or `<h2>` tags.
   - The **main body** might be in `<p>` or inside multiple `<div>`s.

---

### **4. Strategy for Writing `contentScript.js`**
Given the above, our **content script** should:
1. **Wait for the page to load** fully, since content might be inserted dynamically.
2. **Navigate through the page structure**, especially clicking on elements if necessary.
3. **Extract article titles and content** by:
   - Searching for specific **`div` containers** where article content is loaded.
   - Checking for classes/IDs that consistently wrap article text.
   - Handling possible **iframes** if content is loaded inside one.
4. **Save the extracted articles** in `chrome.storage.local`.

---

### **5. Next Steps**
1. **Confirm the article container structure**  
   - Open **Developer Tools (F12 → Elements tab) on The Hindu ePaper**.
   - Inspect how **article content is structured** dynamically.

2. **Update `contentScript.js`**  
   - Implement a **script that clicks the hamburger menu** to navigate to the Editorial section.
   - Extract **titles and body content** of articles in that section.

3. **Handle Login Flow (Optional)**
   - If login is required, consider **triggering an automated login click** before extracting.


Example code for contentScript.js

// contentScript.js

(async function () {
  console.log("📰 The Hindu ePaper Extractor Initialized");

  /**
   * Utility: Wait for a specific element to appear in the DOM
   * @param {string} selector - CSS selector of the target element
   * @param {number} timeout - Maximum wait time (default: 10s)
   * @returns {Promise<Element | null>}
   */
  async function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms before checking again
    }
    return null;
  }

  /**
   * Step 1: Click Hamburger Menu (Opens Section List)
   */
  async function openSectionMenu() {
    console.log("🔍 Looking for the menu button...");
    const menuButton = await waitForElement("button[data-test=hamburger-icon]");

    if (menuButton) {
      console.log("✅ Found menu button. Clicking...");
      menuButton.click();
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for menu to expand
    } else {
      console.warn("⚠️ Menu button not found!");
    }
  }

  /**
   * Step 2: Click "Editorial" Section
   */
  async function openEditorialSection() {
    console.log("🔍 Looking for 'Editorial' section...");
    const editorialButton = await waitForElement("button[data-test=section-edit]");

    if (editorialButton) {
      console.log("✅ Found Editorial section. Clicking...");
      editorialButton.click();
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for articles to load
    } else {
      console.warn("⚠️ Editorial section button not found!");
    }
  }

  /**
   * Step 3: Extract All Articles from Editorial Section
   * @returns {Array} List of extracted articles
   */
  function extractArticles() {
    console.log("📖 Extracting articles...");
    const articles = [];
    
    // Adjust the selector based on The Hindu's DOM structure
    const articleContainers = document.querySelectorAll(".article-content-container");

    if (articleContainers.length === 0) {
      console.warn("⚠️ No articles found!");
      return [];
    }

    articleContainers.forEach((container) => {
      const titleElement = container.querySelector("h1, h2, .article-title");
      const contentElement = container.querySelector(".article-body, p");

      if (titleElement && contentElement) {
        articles.push({
          title: titleElement.innerText.trim(),
          content: contentElement.innerText.trim(),
        });
      }
    });

    console.log(`✅ Extracted ${articles.length} articles.`);
    return articles;
  }

  /**
   * Step 4: Store Extracted Articles in Chrome Storage
   * @param {Array} articles
   */
  async function saveArticles(articles) {
    if (articles.length === 0) return;

    // Read existing articles from storage
    let { savedArticles } = await chrome.storage.local.get(["savedArticles"]);
    if (!savedArticles) savedArticles = [];

    // Append new articles
    savedArticles.push(...articles);

    // Save back to storage
    await chrome.storage.local.set({ savedArticles });
    console.log("💾 Articles saved to Chrome Storage.");
  }

  /**
   * Run Extraction Process
   */
  async function runExtractor() {
    await openSectionMenu();
    await openEditorialSection();
    
    const articles = extractArticles();
    await saveArticles(articles);

    console.log("🎉 Extraction Complete!");
  }

  runExtractor();
})();
