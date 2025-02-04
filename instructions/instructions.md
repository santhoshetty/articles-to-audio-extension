

This is a Chrome extension (Manifest V3) that extracts the main text from a webpage, summarizes it, and plays an audio summary whenever you click the extension icon. Because it’s a Chrome extension rather than a standalone web-scraping or browser-automation approach, the workflow is:

1. User visits an article page in Chrome.
2. User clicks the extension’s icon, opening a small popup.
3. When the user clicks save article, the Content script must run through all elements of the web page and consider <p> elements. These are the ones which contain the article. If you want some intelligence, you can send this structure to OPENAI and it can extract the article from the elements.
4. Popup calls an external (or local) summarization API to get a short summary.
5. Popup uses the Web Speech API to convert that summary into spoken audio.

Summarization API will be through OpenAI. The key is present in the env file.

File Structure

new-agent-extension/
  ├─ manifest.json
  ├─ icons/
  │   └─ icon_128.jpg         (example icon)
  ├─ background.js
  ├─ contentScript.js
  ├─ popup.html
  ├─ popup.js
  ├─ articles.html            (the page listing extracted articles)
  └─ articles.js
