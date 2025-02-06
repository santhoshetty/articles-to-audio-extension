document.addEventListener('DOMContentLoaded', async () => {
    // Load saved API keys
    const storage = await chrome.storage.local.get(['openaiKey', 'huggingfaceKey']);
    if (storage.openaiKey) {
        document.getElementById('openaiKey').value = storage.openaiKey;
    }
    if (storage.huggingfaceKey) {
        document.getElementById('huggingfaceKey').value = storage.huggingfaceKey;
    }

    document.getElementById('saveBtn').addEventListener('click', async () => {
        const openaiKey = document.getElementById('openaiKey').value.trim();
        const huggingfaceKey = document.getElementById('huggingfaceKey').value.trim();

        if (!openaiKey || !huggingfaceKey) {
            showStatus('Please enter both API keys', 'error');
            return;
        }

        try {
            // Save both API keys
            await chrome.storage.local.set({ 
                openaiKey: openaiKey,
                huggingfaceKey: huggingfaceKey
            });
            showStatus('API keys saved successfully!', 'success');
        } catch (error) {
            showStatus('Error saving API keys. Please try again.', 'error');
        }
    });

    function showStatus(message, type) {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = `status ${type}`;
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 3000);
    }

    // Add OpenAI API key field
    const openaiKeyInput = document.getElementById('openaiKey');
    chrome.storage.local.get(['openaiKey'], (result) => {
        if (result.openaiKey) {
            openaiKeyInput.value = result.openaiKey;
        }
    });

    openaiKeyInput.addEventListener('change', () => {
        chrome.storage.local.set({ openaiKey: openaiKeyInput.value });
    });
}); 