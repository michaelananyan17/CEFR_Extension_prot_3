// Background service worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('Make it easy! extension installed');
});

// Handle progress updates
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'progressUpdate') {
        // Forward progress updates to popup if it's open
        chrome.runtime.sendMessage({
            action: 'progressUpdate',
            progress: request.progress
        }).catch(() => {
            // Popup might be closed, which is fine
        });
    }
    sendResponse({ success: true });
});