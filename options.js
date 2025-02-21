document.addEventListener('DOMContentLoaded', async () => {
    function showStatus(message, type) {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = `status ${type}`;
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 3000);
    }

    // Show initial status
    showStatus('Extension is ready to use!', 'success');
}); 