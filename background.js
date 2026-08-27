'use strict';

console.clear();

// Utils
// ---------------------------------------------
const debug = false;
function log(...message) {
    if (debug) {
        console.log(...message);
    }
}

function warn(...message) {
    if (debug) {
        console.warn(...message);
    }
}

// Extension options
// ---------------------------------------------

// Get and set default value for each checkbox option.
const extensionOptions = {
    btDlAllFolder: true,
    btDlFolder: false,
};
for (const key in extensionOptions) {
    chrome.storage.local.get(key, (res) => {
        if (res.hasOwnProperty(key)) {
            extensionOptions[key] = res[key];
        }
    });
}

// Download
// ---------------------------------------------
const activeDownloadIds = new Set();
const filenameToDownloadInfo = new Map();
let pendingDownloads = 0;
let remainingLinksUI = 0;
let activeBatchTabUUID = '';
let activeBatchTabId = '';
let activeMessage = {};

function randomChars() {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345678901';

    // Generate a random 32-bit unsigned integer.
    const r = (Math.random() * 0x100000000) >>> 0;

    // Extract 6 bits (values 0-63) four times using fast bitwise operations.
    return CHARS[r & 63] + CHARS[(r >>> 6) & 63] + CHARS[(r >>> 12) & 63] + CHARS[(r >>> 18) & 63];
}

// Returns filename with extension.
function getFilename(downloadItem) {
    const filePath = downloadItem.filename.replace(/\\/g, '/').replace(/\(\d+\)\./, '.');
    return filePath.substring(filePath.lastIndexOf('/') + 1);
}

function getDownloadItemInfo(downloadItem) {
    const filename = getFilename(downloadItem);

    if (filenameToDownloadInfo.has(filename)) {
        return { filename, ...filenameToDownloadInfo.get(filename) };
    } else {
        warn(`Filename '${filename}' cannot be found in:`, [...filenameToDownloadInfo]);
    }
}

chrome.downloads.onCreated.addListener((downloadItem) => {
    // Download started.
    log('(onCreated) Download item:', downloadItem);

    // Get download info.
    const downloadInfo = getDownloadItemInfo(downloadItem);

    // Note:
    // - Native downloads have always property byExtensionName equal to Locoloader.
    // - Non-native downloads should always have download info with tabId property.
    if (downloadItem.byExtensionName === 'Locoloader' || downloadInfo?.hasOwnProperty('tabId')) {
        // Download was created by Locoloader.

        if (!downloadInfo) {
            // Uknown Locoloader download.
            //
            // Note:
            // Downloads should always have download info, because of how getDownloadItemInfo() works,
            // but when worker rapidly restarts then download state may be corrupted and no download info obtained.
            warn('(onDeterminingFilename) Uknown Locoloader download!');
        }
    } else {
        log('(onDeterminingFilename) Download was not created by Locoloader or download state were corrupted.');
        return;
    }

    // Now we are sure that download was created by Locoloader...

    // Add active download.
    activeDownloadIds.add(downloadItem.id);

    if (downloadInfo.tabId) {
        // Non-native download. Close download tab, it's no longer needed.
        try {
            chrome.tabs.remove(downloadInfo.tabId, () => {
                log('Tab closed:', downloadInfo.tabId);
            });
        } catch (e) {
            log('Tab hase been already closed:', downloadInfo.tabId);
        }
    }
});

chrome.downloads.onChanged.addListener((downloadDelta) => {
    log('(onChanged) Download delta:', downloadDelta);

    if (
        downloadDelta.state &&
        (downloadDelta.state.current === 'complete' || downloadDelta.state.current === 'interrupted')
    ) {
        // Download finished successfully.
        // - or -
        // Download was insterrupted by user or another reason.
        chrome.downloads.search({ id: downloadDelta.id }, async (downloadItems) => {
            if (!downloadItems || !downloadItems[0]) {
                warn('(onChanged) Unexpected! Download delta has no download items!');
                return;
            }

            log('(onChanged) Download items:', downloadItems);

            // Get download info.
            const downloadInfo = getDownloadItemInfo(downloadItems[0]);

            // Note:
            // - Native downloads have always property byExtensionName equal to Locoloader.
            // - Non-native downloads should always have download info with tabId property.
            if (downloadItems[0].byExtensionName === 'Locoloader' || downloadInfo?.hasOwnProperty('tabId')) {
                // Download was created by Locoloader.

                if (!downloadInfo) {
                    // Uknown Locoloader download.
                    //
                    // Note:
                    // Downloads should always have download info, because of how getDownloadItemInfo() works,
                    // but when worker rapidly restarts then download state may be corrupted and no download info obtained.
                    warn('(onChanged) Uknown Locoloader download!');
                }
            } else {
                log('(onChanged) Download was not created by Locoloader or download state were corrupted.');
                return;
            }

            // Now we are sure that download was created by Locoloader...

            // Whether download was completed or interrupted, it is no longer active.
            activeDownloadIds.delete(downloadDelta.id);
            filenameToDownloadInfo.delete(downloadInfo?.filename);

            if (downloadDelta.state.current === 'complete') {
                log(`(onChanged) Download finished:`, downloadDelta.id);

                // Only completed downloads are subtracted from remaining links in app UI.
                remainingLinksUI--;
            } else {
                log(`(onChanged) Download interrupted:`, downloadDelta.id);
            }

            log('(onChanged) Remaining active downloads:', activeDownloadIds.size);

            if (downloadInfo?.headerInfoArr?.length) {
                // Remove custom req/res HTTP headers for non-native downloads.
                for (const headerInfo of downloadInfo.headerInfoArr) {
                    removeHeaders(headerInfo.UUID);
                }
            }

            if (downloadInfo?.blobUrl) {
                // Revoke blob URL from memory.
                URL.revokeObjectURL(downloadInfo.blobUrl);
                log('Blob URL revoked.');
            }

            // Set finalUrlIndex of downloaded file for UI.
            const finalUrlIndex = downloadInfo?.isSingle ? '' : (downloadInfo?.linkIndex ?? '');
            log('Final URL index:', finalUrlIndex);

            if (activeBatchTabUUID && activeMessage.links?.length) {
                pendingDownloads++;

                // Download next link.
                setTimeout(async () => {
                    // Only trigger if the batch wasn't cancelled during the delay.
                    if (activeBatchTabUUID && activeMessage.links?.length) {
                        await downloadLinks(activeMessage, 1);
                    }

                    pendingDownloads = Math.max(0, pendingDownloads - 1);
                    checkDownloadCompletion(downloadDelta, finalUrlIndex);
                }, 1000);
            } else if (activeBatchTabUUID && activeMessage.links?.length === 0) {
                // All links have been sent to download queue, but downloading may still be in progress.
                log('All files have been sent to queue.');
                activeMessage = {};
            }

            checkDownloadCompletion(downloadDelta, finalUrlIndex);
        });
    }
});

function checkDownloadCompletion(downloadDelta, finalUrlIndex) {
    log('--- CHECK DOWNLOAD COMPLETITION --- start');
    log('activeDownloadIds.size:', activeDownloadIds.size);
    log('activeDownloadIds.values():', [...activeDownloadIds.values()]);
    log('filenameToDownloadInfo.entries():', [...filenameToDownloadInfo.entries()]);
    log('activeMessage.links?.length:', activeMessage.links?.length);
    log('pendingDownloads:', pendingDownloads);
    log('--- CHECK DOWNLOAD COMPLETITION --- end');

    if (activeBatchTabId && activeBatchTabUUID) {
        // Notify app to update UI.
        const message = {
            event: 'DOWNLOAD_PROGRESS',
            target: 'app',
            tabUUID: activeBatchTabUUID,
            remainingLinks: remainingLinksUI,
            finalUrlIndex,
            isDownloaded: downloadDelta.state.current === 'complete',
            finished: !activeDownloadIds.size && !activeMessage.links?.length && !pendingDownloads,
        };

        chrome.tabs.sendMessage(activeBatchTabId, message);

        log('MESSAGE SENT:', message);
    }

    if (!activeDownloadIds.size && !activeMessage.links?.length && !pendingDownloads) {
        log('All files have been downloaded.');
        filenameToDownloadInfo.clear();
        activeBatchTabUUID = '';
        activeBatchTabId = '';
        removeHeadersAll();
    }
}

function normalizeFilename(name, ext, unique = false) {
    const normalizedFileName = name.replace(/[\/\(\)]/g, '-');
    const normalizedFileExt = ext.replace(/[\/\(\)\.]/g, '');

    if (unique) {
        return normalizedFileName + '_' + randomChars() + '.' + normalizedFileExt;
    }

    for (const [key, val] of filenameToDownloadInfo) {
        if (key === `${normalizedFileName}.${normalizedFileExt}`) {
            //  Add random chars to filename when same file is already downloading.
            return normalizedFileName + '_' + randomChars() + '.' + normalizedFileExt;
        }
    }

    return normalizedFileName + '.' + normalizedFileExt;
}

function normalizeFolder(folder) {
    return folder.replace(/[\(\)]/g, '-');
}

async function downloadLinks(message, maxConcurrentDownloads = 3) {
    const links = message.links;

    if (!links) {
        // Batch download have been interrupted by user.
        return;
    }

    if (!links.length) {
        // All links have been downloaded.
        return;
    }

    if (links[links.length - 1].url === 'exceeded') {
        // User can't download more links.
        return;
    }

    // Is it a single download?
    const isSingle = message.event === 'START_DOWNLOAD';

    // Should we create a download folder?
    const createFolder = (isSingle && extensionOptions.btDlFolder) || (!isSingle && extensionOptions.btDlAllFolder);

    // Are all downloads native or not?
    // Download cannot be native if we need to set custom HTTP headers for download.
    let isNativeDownload = true;
    const headerObjArr = [];
    if (message.extActions && message.extActions.headers) {
        if (message.extActions.headers.download && message.extActions.headers.download.length) {
            isNativeDownload = false;
            for (const index in message.extActions.headers.download) {
                decodeCookies(message.extActions.headers.download[index]);
                headerObjArr.push(message.extActions.headers.download[index]);
            }
        } else if (message.extActions.headers.both && message.extActions.headers.both.length) {
            isNativeDownload = false;
            for (const index in message.extActions.headers.both) {
                decodeCookies(message.extActions.headers.both[index]);
                headerObjArr.push(message.extActions.headers.both[index]);
            }
        }
    }

    // Download using tab.
    if (!isNativeDownload) {
        log('Non-native download.');

        // Find any Locoloader tab and init download from it.
        chrome.tabs.query(
            {
                url: ['https://www.locoloader.com/*', 'https://www.locoloader.test/*'],
            },
            async (tabs) => {
                // Did we find any Locoloader tab?
                if (!tabs[0]) {
                    log('No Locoloader tab found.');
                    return;
                }

                // Get and remove link from links array.
                const linkData = links.pop();
                const link = linkData.link;
                const linkIndex = linkData.index;

                // Download
                let url = link.link_url;

                // Filename
                let filename = normalizeFilename(link.file_name, link.file_ext);

                // Add folder to filename.
                if (createFolder && message.folder) {
                    filename = normalizeFolder(message.folder) + '_' + filename;
                }

                if (link.download === 'raw') {
                    // Raw files live in memory, so there is no need to set custom headers to download them.
                    // Localoader uses raw files only for custom M3U8 files.

                    // Convert raw URL to Blob so Firefox can download it.
                    url = `data:application/octet-stream;base64,${link.link_raw}`;
                    const response = await fetch(url);
                    const blob = await response.blob();
                    url = URL.createObjectURL(blob);

                    // Save download info.
                    const downloadInfo = {
                        linkIndex,
                        isSingle,
                        blobUrl: url,
                    };
                    filenameToDownloadInfo.set(filename, downloadInfo);
                    log('Saved:', filename, downloadInfo);

                    // Init download.
                    await chrome.downloads.download({
                        url,
                        filename,
                        saveAs: false,
                        conflictAction: 'overwrite',
                    });
                }

                if (link.download === 'url') {
                    // Create empty download tab.
                    const tab = await chrome.tabs.create({ active: false });

                    // Set headers only to download tab.
                    headerObjArr.push({
                        action: {
                            type: 'modifyHeaders',
                            responseHeaders: [
                                {
                                    header: 'content-disposition',
                                    operation: 'set',
                                    value: 'attachment; filename=' + filename,
                                },
                            ],
                        },
                        condition: {
                            tabIds: [tab.id],
                            resourceTypes: ['main_frame', 'media'],
                        },
                    });

                    const headerInfoArr = [];
                    for (const headerObj of headerObjArr) {
                        headerObj.condition['tabIds'] = [tab.id];

                        const headerInfo = await setHeaders(headerObj.action, headerObj.condition);
                        if (headerInfo) {
                            headerInfoArr.push(headerInfo);
                        }
                    }

                    // Save download info.
                    const downloadInfo = {
                        linkIndex,
                        isSingle,
                        headerInfoArr,
                        tabId: tab.id,
                    };
                    filenameToDownloadInfo.set(filename, downloadInfo);
                    log('Saved:', filename, downloadInfo);

                    // Init download.
                    await chrome.tabs.update(tab.id, { url, active: false });

                    // Manage error tabs.
                    setTimeout(async () => {
                        // Close Locoloader download tab.
                        chrome.tabs.remove(tab.id)
                            .then(async () => {
                                log('Tab closed because of error:', tab.id);
                                filenameToDownloadInfo.delete(filename);

                                // Close Firefox ghost tab.
                                chrome.tabs.remove(tab.id + 1)
                                    .catch((err) => {
                                        warn('Failed to close ghost tab:', err);
                                    });

                                // Remove tab headers.
                                for (const headerInfo of headerInfoArr) {
                                    removeHeaders(headerInfo.UUID);
                                }

                                if (activeBatchTabId && activeBatchTabUUID) {
                                    // Initiate next download.
                                    await downloadLinks(message);
                                }

                                if (!activeDownloadIds.size && !message.links?.length && !pendingDownloads) {
                                    log('Batch download complete, but with errors.');

                                    if (activeBatchTabId && activeBatchTabUUID) {
                                        // Notify app to update UI.
                                        chrome.tabs.sendMessage(activeBatchTabId, {
                                            event: 'DOWNLOAD_PROGRESS',
                                            target: 'app',
                                            tabUUID: activeBatchTabUUID,
                                            remainingLinks: remainingLinksUI,
                                            finalUrlIndex: '',
                                            finished: true,
                                        });
                                    }

                                    activeBatchTabId = '';
                                    activeBatchTabUUID = '';
                                }

                                if (!activeBatchTabId && !activeBatchTabUUID) {
                                    log('Batch download stopped by user or complete, but with errors.');
                                    activeMessage = {};
                                    filenameToDownloadInfo.clear();
                                    removeHeadersAll();
                                }
                            })
                            .catch((err) => {
                                log('Download tab has been already closed as expected:', tab.id);
                            });
                    }, 2000);
                }
            },
        );
    }

    // Download using native download function.
    if (isNativeDownload) {
        log('Native download.');

        // Init max concurrent downloads.
        while (links.length > 0 && maxConcurrentDownloads) {
            // Decrease number of concurrent downloads.
            maxConcurrentDownloads--;

            // Get and remove link from reversed links array.
            const linkData = links.pop();
            const link = linkData.link;
            const linkIndex = linkData.index;

            // URL
            let url = link.link_url;
            if (link.download === 'raw') {
                url = `data:application/octet-stream;base64,${link.link_raw}`;

                // Convert data URL to Blob so Firefox can download it.
                const response = await fetch(url);
                const blob = await response.blob();
                url = URL.createObjectURL(blob);
            }

            // Filename
            let filename = normalizeFilename(link.file_name, link.file_ext);

            // Save download info.
            const downloadInfo = {
                linkIndex,
                isSingle,
                blobUrl: link.download === 'raw' ? url : '',
            };
            filenameToDownloadInfo.set(filename, downloadInfo);
            log('Saved:', filename, downloadInfo);

            // Add folder to filename.
            if (createFolder && message.folder) {
                filename = normalizeFolder(message.folder) + '/' + filename;
            }

            // Download
            await chrome.downloads.download({
                url,
                filename,
                saveAs: false,
                conflictAction: 'overwrite',
            });
        }
    }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeBatchTabId) {
        log('Batch tab closed prematurely. Stop any further downloads.');
        activeBatchTabUUID = '';
        activeBatchTabId = '';
        activeMessage = {};
    }
});

// Open pre-configured tab with fetcher.js.
// ---------------------------------------------
const activeFetcherTabs = new Map();

function openFetcher(message, sender) {
    return new Promise(async (resolve) => {
        const defaultResponse = [
            {
                result: {
                    event: 'PRE_EXTRACTION',
                    target: 'app',
                    tabUUID: message.tabUUID,
                    url: message.url,
                    headers: {},
                    html: '',
                    dom: '',
                    actions: {
                        err: [],
                        result: [],
                    },
                    xhr: [],
                    windowURL: message.windowURL,
                },
            },
        ];

        // Open tab.
        const tab = await chrome.tabs.create({ active: false });
        activeFetcherTabs.set(sender.tab.id, tab.id);

        // Set headers only to fetcher tab.
        log('Received headers:', message.headers);
        const headerInfoArr = [];
        for (const headerObj of message.headers) {
            headerObj.condition['tabIds'] = [tab.id];

            const headerInfo = await setHeaders(headerObj.action, headerObj.condition);
            if (headerInfo) {
                headerInfoArr.push(headerInfo);
            }
        }

        // Remove tab headers.
        function cleanupHeaders(headerInfoArr) {
            for (const headerInfo of headerInfoArr) {
                removeHeaders(headerInfo.UUID);
            }
        }

        // Decoded LEJP string (Locoloader extraction JSON payload).
        async function decodeLejp(lejp) {
            if (!lejp) {
                return null;
            }

            try {
                // Convert base64 URL encoded string to compressed buffer.
                const base64 = lejp.replace(/-/g, '+').replace(/_/g, '/');
                const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

                // Decompress buffer to base64 URL decoded string.
                const stream = new Blob([bytes]).stream();
                const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
                const response = new Response(decompressedStream);
                return await response.text();
            } catch (err) {
                return null;
            }
        }

        // Strip and get encoded LEJP from URL.
        const [url, lejp] = message.url.split('##ll##');

        // Update message with stripped URL and decoded LEJP.
        message['url'] = url;
        message['lejp'] = (await decodeLejp(decodeURIComponent(lejp))) || '';

        // Update default response with stripped URL to keep consistency with fetcher.js result.
        defaultResponse[0].result.url = url;

        // Determines when fetcher runs.
        const runAt = message.actions?.runAt === 'document_start' ? message.actions.runAt : 'document_loaded';
        log('Run at:', runAt);

        // Fetcher script content.
        let scriptContent = '';

        if (message.actions?.script) {
            // Avoid path traversal attack using base folder URL.
            const baseFolderUrl = browser.runtime.getURL('extractors/');
            const scriptUrl = new URL(`${message.actions.script}.js`, baseFolderUrl).href;
            log('Script to fetch:', scriptUrl);

            // Read script.
            const response = await fetch(scriptUrl);
            if (response?.ok) {
                log('Script successfuly fetched.');
                scriptContent = await response.text();
            }

            message['script'] = scriptContent;
        }

        // Fetcher result.
        let result;

        if (runAt === 'document_start') {
            // Register scripts to final tab URL.
            await chrome.scripting.registerContentScripts([
                {
                    id: tab.id + '-relay',
                    matches: [url + '*'],
                    runAt: 'document_start',
                    world: 'ISOLATED',
                    js: ['fetcher-result.js'],
                },
                {
                    id: tab.id + '-main',
                    matches: [url + '*'],
                    runAt: 'document_start',
                    world: 'MAIN',
                    js: ['fetcher.js'],
                },
            ]);

            // Prepare tab URL with fetcher arguments.
            const tabUrl = new URL(url);
            tabUrl.hash = `fetcher-arg=${btoa(encodeURIComponent(JSON.stringify(message)))}`;

            // Open tab URL with fetcher arguments and wait for fetcher result.
            result = await new Promise((resolve) => {
                const timeoutId = setTimeout(() => {
                    cleanup();
                    resolve(defaultResponse);
                    log(`Timeout: Fetcher in tab ${tab.id} never returned a result.`);
                }, 65000);

                const messageListener = (msg, sender) => {
                    if (sender.tab?.id === tab.id && msg.target === 'ext' && msg.event === 'FETCHER_RESULT') {
                        cleanup();
                        resolve([{ result: msg.data }]);
                    }
                };

                function closeListener(closedTabId) {
                    if (closedTabId === tab.id) {
                        cleanup();
                        resolve(defaultResponse);
                        log(`Tab ${tab.id} closed prematurely.`);
                    }
                }

                function cleanup() {
                    activeFetcherTabs.delete(sender.tab.id);
                    chrome.runtime.onMessage.removeListener(messageListener);
                    chrome.tabs.onRemoved.removeListener(closeListener);
                    clearTimeout(timeoutId);
                };

                chrome.runtime.onMessage.addListener(messageListener);
                chrome.tabs.onRemoved.addListener(closeListener);
                chrome.tabs.update(tab.id, { url: tabUrl.toString(), active: false });
            });
        }

        if (runAt === 'document_loaded') {
            // Open tab, wait for URL update and content load.
            const isTabLoaded = await new Promise((resolve) => {
                const timeoutId = setTimeout(() => {
                    cleanup();
                    resolve(false);
                    log(`Timeout: Tab ${tab.id} took too long to load.`);
                }, 65000);

                function updateListener(tabId, changeInfo, currentTab) {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        if (currentTab.url && currentTab.url !== 'about:blank' && currentTab.url !== 'about:newtab') {
                            cleanup();
                            resolve(true);
                            log(`Tab ${tab.id} loading complete.`);
                        }
                    }
                }

                function closeListener(closedTabId) {
                    if (closedTabId === tab.id) {
                        cleanup();
                        resolve(false);
                        log(`Tab ${tab.id} closed prematurely.`);
                    }
                }

                function cleanup() {
                    chrome.tabs.onUpdated.removeListener(updateListener);
                    chrome.tabs.onRemoved.removeListener(closeListener);
                    clearTimeout(timeoutId);
                }

                chrome.tabs.onUpdated.addListener(updateListener);
                chrome.tabs.onRemoved.addListener(closeListener);
                chrome.tabs.update(tab.id, { url, active: false });
            });

            if (!isTabLoaded) {
                // Tab has been closed prematurely or timed-out.
                activeFetcherTabs.delete(sender.tab.id);
                cleanupHeaders(headerInfoArr);
                return resolve(defaultResponse);
            }

            // Configure fetcher.
            const injectionResult = await ensureExecuteScript({
                world: 'MAIN',
                target: { tabId: tab.id },
                func: (message) => {
                    document.LLmessage = message;
                },
                args: [message],
            });
            if (!injectionResult) {
                log(`Injecting fetcher config failed.`);
                cleanupHeaders(headerInfoArr);
                return resolve(defaultResponse);
            }

            // Run fetcher and get result.
            result = await ensureExecuteScript({
                world: 'MAIN',
                target: { tabId: tab.id },
                files: ['fetcher.js'],
            });
        }

        log('Tab in background.js received result from fetcher.js:', result);

        // Cleanup.
        if (runAt === 'document_start') {
            // Remove registered tab scripts.
            await chrome.scripting.unregisterContentScripts({ ids: [tab.id + '-relay', tab.id + '-main'] });
        }

        activeFetcherTabs.delete(sender.tab.id);
        cleanupHeaders(headerInfoArr);

        try {
            // Close fetcher tab.
            await chrome.tabs.remove(tab.id);
        } catch (err) {
            // Tab has been closed prematurely.
            return resolve(defaultResponse);
        }

        // If response contains reFetch attribute, it means that page should be re-fetched.
        if (result?.[0]?.result?.reFetch) {
            setTimeout(async () => {
                // Only re-fetch once.
                message['doNotReFetch'] = true;

                // Re-open, re-fetch and return result from fetcher.js.
                resolve(await openFetcher(message, sender));
            }, 2000);
        } else {
            // Return result from fetcher.js.
            resolve(result);
        }
    });
}

async function ensureExecuteScript(scriptOptions, maxRetries = 5, delayMs = 50) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await chrome.scripting.executeScript(scriptOptions);
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    log(`Script injection failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
    return false;
}

// Listening to message
// ---------------------------------------------
async function isActiveTabPrivate() {
    const allowed = await browser.extension.isAllowedIncognitoAccess();
    if (!allowed) {
        // Extension is not allowed to run in incognito mode.
        return false;
    }

    // Get last focused window.
    const win = await browser.windows.getLastFocused();

    // Get tab matching last focused window.
    const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
    if (!tab) {
        // No tab is open.
        return false;
    }

    return !!tab.incognito;
}

chrome.runtime.onMessage.addListener(async (message, sender) => {
    log('Background.js received message from content script:', message);
    log('Sender:', sender);
    log('Runtime ID:', chrome.runtime.id);

    // Allow only trusted messages.
    if (
        sender.origin !== 'https://www.locoloader.com' &&
        sender.origin !== 'https://www.locoloader.test' &&
        sender.id !== chrome.runtime.id
    ) {
        return true;
    }

    // Accept only message addressed to extension.
    if (message.target !== 'ext') {
        return true;
    }

    if (message.event === 'UPDATE_OPTIONS') {
        extensionOptions[message.optionName] = message.optionVal;
        return true;
    }

    if (message.event === 'START_DOWNLOAD') {
        if (activeBatchTabUUID) {
            chrome.tabs.sendMessage(sender.tab.id, {
                event: 'ERROR_ALREADY_DOWNLOADING',
                target: 'app',
                tabUUID: activeBatchTabUUID,
            });
            return true;
        }

        downloadLinks(message);
        return true;
    }

    if (message.event === 'START_BATCH_DOWNLOAD') {
        if (activeBatchTabUUID) {
            chrome.tabs.sendMessage(sender.tab.id, {
                event: 'ERROR_ALREADY_DOWNLOADING',
                target: 'app',
                tabUUID: activeBatchTabUUID,
            });
            return true;
        }

        activeBatchTabId = sender.tab.id;
        activeBatchTabUUID = message.tabUUID;
        activeMessage = message;
        remainingLinksUI = message.links?.length || 0;

        // Notify app to update UI.
        chrome.tabs.sendMessage(sender.tab.id, {
            event: 'DOWNLOAD_PROGRESS',
            target: 'app',
            tabUUID: activeBatchTabUUID,
            remainingLinks: remainingLinksUI,
        });

        downloadLinks(activeMessage);
        return true;
    }

    if (message.event === 'STOP_BATCH_DOWNLOAD') {
        // Stop current downloads.
        activeDownloadIds.forEach((id) => chrome.downloads.cancel(id));
        activeDownloadIds.clear();

        if (activeBatchTabUUID) {
            // Notify app to update UI.
            chrome.tabs.sendMessage(sender.tab.id, {
                event: 'DOWNLOAD_PROGRESS',
                target: 'app',
                tabUUID: activeBatchTabUUID,
                remainingLinks: remainingLinksUI,
                finished: true,
            });
        }

        activeBatchTabUUID = '';
        activeBatchTabId = '';
        activeMessage = {};
        return true;
    }

    if (message.event === 'STOP_FETCHER') {
        // Close active fetcher tabs from this sender.
        const tabId = activeFetcherTabs.get(sender.tab.id);
        if (tabId) {
            chrome.tabs.remove(tabId).catch((err) => {
                log('Failed to close fetcher tab:', err);
            });
            activeFetcherTabs.delete(sender.tab.id);
        }
    }

    if (message.event === 'PREVIEW') {
        // Determine preview tab URL.
        let tabUrl = message.previewURL;

        if (
            message.player === 'true' ||
            (message.extActions && message.extActions.playerPreview) ||
            message.linkType === 'raw'
        ) {
            // Use player.html for preview instead of native player.
            const previewId = 'preview_' + crypto.randomUUID();
            tabUrl = chrome.runtime.getURL(`player.html?data=${message.linkType}&previewId=${previewId}`);
            await chrome.storage.session.set({ [previewId]: message.previewURL });
        }

        // Set preview link headers retrieved from extension actions.
        const headerObjArr = [];
        if (message.extActions && message.extActions.headers) {
            if (message.extActions.headers.preview && message.extActions.headers.preview.length) {
                for (const index in message.extActions.headers.preview) {
                    decodeCookies(message.extActions.headers.preview[index]);
                    headerObjArr.push(message.extActions.headers.preview[index]);
                }
            } else if (message.extActions.headers.both && message.extActions.headers.both.length) {
                for (const index in message.extActions.headers.both) {
                    decodeCookies(message.extActions.headers.both[index]);
                    headerObjArr.push(message.extActions.headers.both[index]);
                }
            }
        }

        // Create empty preview tab.
        const tab = await chrome.tabs.create({ active: false });

        // Set headers only to preview tab.
        const headerInfoArr = [];
        for (const headerObj of headerObjArr) {
            headerObj.condition['tabIds'] = [tab.id];

            const headerInfo = await setHeaders(headerObj.action, headerObj.condition);
            if (headerInfo) {
                headerInfoArr.push(headerInfo);
            }
        }

        const closeTabListener = (tabId) => {
            if (tabId === tab.id) {
                // Remove declarativeNetRequest session rules (remove preview link headers).
                for (const headerInfo of headerInfoArr) {
                    removeHeaders(headerInfo.UUID);
                }
                chrome.tabs.onRemoved.removeListener(closeTabListener);
                log('Preview tab closed id:', tabId);
            }
        };

        chrome.tabs.onRemoved.addListener(closeTabListener);

        // Update preview tab.
        await chrome.tabs.update(tab.id, { url: tabUrl, active: true });

        return true;
    }

    // Workaround for missing "incognito": "split" option.
    const isPrivate = await isActiveTabPrivate();
    if (isPrivate && message.type === 'ext-fetch') {
        message.type = 'ext-tab';
        message['headers'] = {};
        message['actions'] = [];
        message['xhr'] = [];
    }

    if (message.type === 'ext-fetch') {
        // Default response.
        const pageObj = {
            event: 'PRE_EXTRACTION',
            target: 'app',
            tabUUID: message.tabUUID,
            url: message.url,
            headers: {},
            html: '',
        };

        // Set request headers...
        let requestHeaders = [];

        // ...other HTTP headers
        if (message.fetchOptions.headers && Object.keys(message.fetchOptions.headers)) {
            for (const [key, val] of Object.entries(message.fetchOptions.headers)) {
                requestHeaders.push({
                    header: key,
                    operation: 'set',
                    value: val,
                });
            }
        }

        // ...referer
        if (message.fetchOptions.referrer) {
            requestHeaders.push({
                header: 'Referer',
                operation: 'set',
                value: message.fetchOptions.referrer,
            });
        }

        // ...referer policy
        if (message.fetchOptions.referrerPolicy) {
            requestHeaders.push({
                header: 'Referrer-Policy',
                operation: 'set',
                value: message.fetchOptions.referrerPolicy,
            });
        }

        // ...set headers
        let headerInfo = {};
        if (requestHeaders.length) {
            headerInfo = await setHeaders(
                {
                    type: 'modifyHeaders',
                    requestHeaders,
                },
                {
                    resourceTypes: ['xmlhttprequest'],
                    urlFilter: `|${message.url}|`,
                },
            );
        }

        let fetchResponse = null;
        try {
            // Send request.
            fetchResponse = await fetch(message.url, message.fetchOptions ? message.fetchOptions : {});
        } catch (e) { }

        // Remove request headers.
        if (typeof headerInfo.UUID !== 'undefined') {
            removeHeaders(headerInfo.UUID);
        }

        if (!fetchResponse) {
            chrome.tabs.sendMessage(sender.tab.id, pageObj);
            return;
        }

        // ...get page HTML
        pageObj.html = await fetchResponse.text();

        // ...get page HTTP headers
        pageObj.headers = Object.fromEntries(fetchResponse.headers.entries());

        // Send response.
        chrome.tabs.sendMessage(sender.tab.id, pageObj);
    }

    if (message.type === 'ext-tab') {
        // Close active fetcher tabs from this sender.
        const tabId = activeFetcherTabs.get(sender.tab.id);
        if (tabId) {
            chrome.tabs.remove(tabId).catch((err) => {
                log('Failed to close fetcher tab:', err);
            });
            activeFetcherTabs.delete(sender.tab.id);
        }

        const pageObj = await openFetcher(message, sender);
        log('Pre-extraction data:', pageObj);

        // Response.
        chrome.tabs.sendMessage(
            sender.tab.id,
            pageObj
                ? pageObj[0]?.result
                : { event: 'PRE_EXTRACTION', target: 'app', tabUUID: message.tabUUID, html: '' },
        );
    }

    // Mandatory: Keeps message channel open for async response.
    return true;
});

// HTTP request / response modifications
// ---------------------------------------------

// Decode HTTP request cookie header value.
function decodeCookies(headersObj) {
    if (headersObj.action && headersObj.action.requestHeaders) {
        for (const key in headersObj.action.requestHeaders) {
            if (headersObj.action.requestHeaders[key].header === 'cookie') {
                headersObj.action.requestHeaders[key].value = decodeURIComponent(
                    headersObj.action.requestHeaders[key].value,
                );
            }
        }
    }
}

// Initial HTTP headers state.
let headerCount = 0;
let headerHash = {};

// Fast and good enough hashing function to generate HTTP header UUID.
function hash(string) {
    let hash = 0,
        i,
        chr;
    if (string.length === 0) {
        return hash;
    }
    for (i = 0; i < string.length; i++) {
        chr = string.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0;
    }
    return hash;
}

// Set declarativeNetRequest HTTP headers.
async function setHeaders(action, condition) {
    if (!action || !condition) {
        // Cannot update session rules without both action and condition.
        return;
    }

    // Remove disallowed headers.
    sanitizeHeaders(action.requestHeaders);
    sanitizeHeaders(action.responseHeaders);

    // Generate header uid.
    const jsonString = JSON.stringify({ action, condition });
    const headerUUID = hash(jsonString);

    // Do not set same header multiple times.
    if (headerHash[headerUUID]) {
        return headerHash[headerUUID];
    }

    // Update number of active headers.
    headerCount++;

    // Header info JSON.
    const headerInfo = {
        id: headerCount,
        UUID: headerUUID,
    };

    // Store active header info.
    headerHash[headerUUID] = headerInfo;

    log('Set headers (ruleId):', headerInfo.id);
    log('Set headers (hash):', headerInfo.UUID);
    log('Set headers (action):', action);
    log('Set headers (condition):', condition);

    // Set HTTP header.
    await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
            {
                id: headerInfo.id,
                priority: 1,
                action,
                condition,
            },
        ],
        removeRuleIds: [headerInfo.id],
    });

    // Return header info.
    return headerInfo;
}

// Ensure disallowed headers are removed.
function sanitizeHeaders(headerArr) {
    const DISALLOWED_HEADERS = new Set([
        // Core Security Policies.
        'content-security-policy',
        'content-security-policy-report-only',
        'strict-transport-security',

        // Framing and Sniffing Protections.
        'x-frame-options',
        'x-content-type-options',
        'x-xss-protection',

        // Cross-Origin Isolation.
        'cross-origin-embedder-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',

        // CORS Headers.
        'access-control-allow-origin',
        'access-control-allow-credentials',
        'access-control-allow-methods',
        'access-control-allow-headers',

        // Feature Permissions
        'permissions-policy',
        'feature-policy',
    ]);

    if (Array.isArray(headerArr)) {
        for (let i = headerArr.length - 1; i >= 0; i--) {
            const item = headerArr[i];
            if (typeof item?.header === 'string' && DISALLOWED_HEADERS.has(item.header.toLowerCase())) {
                headerArr.splice(i, 1);
            }
        }
    }
}

// Remove declarativeNetRequest HTTP headers.
function removeHeaders(headerUUID) {
    // Do not try removing non-existing headers.
    if (!headerHash[headerUUID]) {
        return;
    }

    log('Remove headers (ruleId):', headerHash[headerUUID].id);
    log('Remove headers (hash):', headerHash[headerUUID].UUID);

    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [headerHash[headerUUID].id],
    });

    delete headerHash[headerUUID];
    headerCount--;
}

// Remove all declarativeNetRequest HTTP headers.
async function removeHeadersAll() {
    for (const key in headerHash) {
        removeHeaders(headerHash[key].UUID, true);
    }

    const existingRules = await chrome.declarativeNetRequest.getSessionRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);
    chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existingRuleIds,
    });

    log('All headers removed:', headerCount);
}

// Remove all declarativeNetRequest session rules.
removeHeadersAll();

// Debug matched net requests
// This feature requires 'declarativeNetRequestFeedback' permission in manifest.json
// todo Comment this out for production
// chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
//     log("onRuleMatchedDebug:", info);
// });

// Extension management.
// ---------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
    chrome.tabs.query(
        {
            url: ['https://www.locoloader.com/*', 'https://www.locoloader.test/*'],
        },
        (tabs) => {
            if (
                !tabs.length &&
                details.reason &&
                chrome.runtime.OnInstalledReason &&
                chrome.runtime.OnInstalledReason.INSTALL &&
                details.reason === chrome.runtime.OnInstalledReason.INSTALL
            ) {
                // Open Locoloader page upon installation if no other Locoloader pages are open.
                chrome.tabs.create({ url: 'https://www.locoloader.com' });
            }

            // Reload Locoloader pages when user installs extension.
            for (const tab of tabs) {
                setTimeout(() => {
                    log('Tab reloaded:' + tab.id);
                    chrome.tabs.reload(tab.id);
                }, 100);
            }
        },
    );
});

// Reload Locoloader pages when user enables extension.
chrome.management.onEnabled.addListener((extension) => {
    if (extension.id === chrome.runtime.id) {
        chrome.tabs.query(
            {
                url: ['https://www.locoloader.com/*', 'https://www.locoloader.test/*'],
            },
            (tabs) => {
                for (const tab of tabs) {
                    setTimeout(() => {
                        log('Tab reloaded:' + tab.id);
                        chrome.tabs.reload(tab.id);
                    }, 100);
                }
            },
        );
    }
});

// Automatically update extension as soon as possible.
chrome.runtime.onUpdateAvailable.addListener(() => {
    chrome.runtime.reload();
});
