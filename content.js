// Utils
// ---------------------------------------------
const debug = false;
function log(...message) {
    if (debug) {
        console.log(...message);
    }
}

// Prevent to inject content.js to same page repeatedly
// ----------------------------------------------------
if (typeof document.injected == 'undefined') {
    log('Content script has been injected.')
    document.injected = true;

    // Listening for window.message
    // ---------------------------------------------
    const pageMessageListener = (message) => {
        log('Content.js received window.message from app.js or content.js:', message);

        // Allow only trusted messages.
        if (message.source !== window) {
            return;
        }
        if (message.origin !== 'https://www.locoloader.com' && message.origin !== 'https://www.locoloader.test') {
            return;
        }

        // Redirect only messages addressed to extension.
        if (message.data.target !== 'ext') {
            return;
        }

        log('Content.js: runtime.sendMessage(): to background.js and app.js:', message.data);
        chrome.runtime.sendMessage(message.data);

    };
    window.removeEventListener('message', pageMessageListener);
    window.addEventListener('message', pageMessageListener);

    // Listening for message
    // ---------------------------------------------
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log('Content.js received message from background.js:', message);
        log('Sender', sender);
        log('Runtime ID:', chrome.runtime.id);

        // Allow only trusted messages.
        if (sender.id !== chrome.runtime.id) {
            return;
        }

        // Redirect only messages addressed to app.
        if (message.target !== 'app') {
            return;
        }

        log('Content.js: window.postMessage(): to app.js and content.js:', message);
        window.postMessage(message, window.location.origin);
    });
}
