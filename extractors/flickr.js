// (async () => {
function SB_go(lejp = '') {
    return new Promise((resolve) => {
        let response = {
            err: [],
            content: [],
            nextUrl: [],
        };

        const url = window.location.href;

        if (/^https?:\/\/(www\.)?flickr\.com\/photos\/[^\/]+\/\d+\/?/.test(url)) {
            extractImage();
        } else if (/^https?:\/\/(www\.)?flickr\.com\/photos\/[^\/]+\/galleries\/\d+/.test(url)) {
            extractGallery();
        } else if (/^https?:\/\/(www\.)?flickr\.com\/photos\/[^\/]+\/albums\/\d+/.test(url)) {
            extractAlbum();
        } else if (/^https?:\/\/(www\.)?flickr\.com\/photos\/[^\/\?]+/.test(url)) {
            extractStream();
        } else if (/^https?:\/\/(www\.)?flickr\.com\/groups\/[^\/]+\/pool(\/|$)/.test(url)) {
            extractGroup();
        } else if (/^https?:\/\/(www\.)?flickr\.com\/search\/?.*[&?](text|tags)=.+/.test(url)) {
            extractSearch();
        } else if (/^https?:\/\/api\.flickr\.com\/services\/rest/.test(url)) {
            extractApi();
        } else {
            response.err.push('Unsupported content type.');
            resolve(response);
            return;
        }

        // A WeakSet acts as a ledger to track objects we have already scanned.
        // JavaScript environments contain circular references (e.g., window.window).
        // Tracking seen objects prevents infinite loops that would crash the browser.
        const seen = new WeakSet();

        function findParsedData(obj, targetKey, path = 'window') {
            // Stop execution if the item is not an object, is null, or was already scanned.
            if (!obj || typeof obj !== 'object' || seen.has(obj)) return;

            // Mark the current object as scanned.
            seen.add(obj);

            try {
                // Dynamically check if the targetKey exists directly on this specific object layer.
                if (targetKey in obj && typeof obj[targetKey] === 'object' && obj[targetKey] !== null) {
                    // YUI stores both schemas (blueprints) and the populated data.
                    // We filter out the schema (which has isCollection: true) to isolate the live parsed data.
                    if (!obj[targetKey].isCollection && Array.isArray(obj[targetKey]._data) && obj[targetKey]._data.length) {
                        // Output the exact global path so the data can be queried directly in the future.
                        // console.log({ path, obj });
                        return { path, obj };
                    }
                }
            } catch (e) {
                // Browsers block scripts from reading cross-origin data (like third-party iframes).
                // This catch block silently swallows those fatal security errors so the crawler keeps running.
            }

            // Recursively traverse every property inside the current object.
            for (let key in obj) {
                try {
                    // Pass the child object back into the function, appending the current key to the path string.
                    // findParsedData(obj[key], targetKey, `${path}.${key}`);
                    const result = findParsedData(obj[key], targetKey, `${path}.${key}`);

                    // Only return if we actually found what we were looking for.
                    // Otherwise, let the loop continue to the next key.
                    if (result) {
                        return result;
                    }
                } catch (e) {
                    // Silently ignore access errors on restricted child properties.
                }
            }
        }

        async function extractImage() {
            const domHtml = getDomHtml();

            // Extract and decode inline data.
            const dataJson = extractNestedJson(domHtml, 'modelExport');
            if (!dataJson) {
                response.err.push('Cannot extract data.');
                resolve(response);
                return;
            }

            // Check if expected data is present.
            if (!dataJson.main?.['photo-models']) {
                response.err.push('Cannot get data, API changed.');
                resolve(response);
                return;
            }

            // Process inline data.
            await processInlineData(dataJson.main['photo-models'], domHtml);

            resolve(response);
        }

        async function extractStream() {
            const domHtml = getDomHtml();

            // Extract and decode inline data.
            const dataJson = extractNestedJson(domHtml, 'modelExport');
            if (!dataJson) {
                response.err.push('Cannot extract data.');
                resolve(response);
                return;
            }

            // Check if expected data is present.
            if (!dataJson.main?.['photostream-models']?.[1]?.data?.photoPageList?.data?._data) {
                response.err.push('Cannot get data, API changed.');
                resolve(response);
                return;
            }

            // Process inline data.
            await processInlineData(dataJson.main['photostream-models'][1].data.photoPageList.data._data, domHtml);

            resolve(response);
        }

        async function extractGroup() {
            const domHtml = getDomHtml();

            // Extract and decode inline data.
            const dataJson = extractNestedJson(domHtml, 'modelExport');
            if (!dataJson) {
                response.err.push('Cannot extract data.');
                resolve(response);
                return;
            }

            // Extract contributor id.
            const contributorId = domHtml.match(/"personFilter":\s*"([^"]+)/)?.[1] || '';

            // Set data key by contributor id.
            const dataKey = contributorId ? 'group-pool-by-person-models' : 'group-pool-models';

            // Check if expected data is present.
            if (!dataJson.main?.[dataKey]?.[0]?.data?.photoPageList?.data?._data) {
                response.err.push('Cannot get data, API changed.');
                resolve(response);
                return;
            }

            // Process inline data.
            await processInlineData(dataJson.main[dataKey][0].data.photoPageList.data._data, domHtml);

            resolve(response);
        }

        async function extractAlbum() {
            const domHtml = getDomHtml();

            // Extract and decode inline data.
            const dataJson = extractNestedJson(domHtml, 'modelExport');
            if (!dataJson) {
                response.err.push('Cannot extract data.');
                resolve(response);
                return;
            }

            // Check if expected data is present.
            if (!dataJson.main?.['set-models']?.[0]?.data?.photoPageList?.data?._data) {
                response.err.push('Cannot get data, API changed.');
                resolve(response);
                return;
            }

            // Process inline data.
            await processInlineData(dataJson.main['set-models'][0].data.photoPageList.data._data, domHtml);

            resolve(response);
        }

        async function extractGallery() {
            resolve(response);
        }

        async function extractSearch() {
            resolve(response);
        }

        async function extractApi() {
            let dataJson;

            try {
                dataJson = JSON.parse(document.body.innerText);
            } catch {
                response.err.push('Cannot parse JSON.');
                resolve(response);
            }

            const key = window.location.href?.includes('method=flickr.photosets.getPhotos') ? 'photoset' : 'photos';
            await processApiData(dataJson, key);
            resolve(response);
        }

        function getDomHtml() {
            return new XMLSerializer().serializeToString(document.doctype) + document.getElementsByTagName('html')[0].outerHTML;
        }

        function extractNestedJson(html, key) {
            if (typeof html !== 'string' || !key) return null;

            // Escape special regex characters in the key
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match the key (quoted or unquoted) followed by a colon and an opening brace/bracket
            const regex = new RegExp(`(?:["']?${escapedKey}["']?)\\s*:\\s*([\\{\\[])`, 'g');
            const match = regex.exec(html);

            if (!match) return null;

            const openChar = match[1];
            const closeChar = openChar === '{' ? '}' : ']';
            // Start index right at the opening '{' or '['
            const startIndex = match.index + match[0].length - 1;

            let depth = 0;
            let inString = false;
            let stringQuote = '';
            let isEscaped = false;

            for (let i = startIndex; i < html.length; i++) {
                const char = html[i];

                if (isEscaped) {
                    isEscaped = false;
                    continue;
                }

                if (char === '\\') {
                    isEscaped = true;
                    continue;
                }

                if (inString) {
                    if (char === stringQuote) {
                        inString = false;
                    }
                    continue;
                }

                if (char === '"' || char === "'") {
                    inString = true;
                    stringQuote = char;
                    continue;
                }

                if (char === openChar) {
                    depth++;
                } else if (char === closeChar) {
                    depth--;
                    if (depth === 0) {
                        const jsonCandidate = html.slice(startIndex, i + 1);
                        try {
                            return JSON.parse(jsonCandidate);
                        } catch (err) {
                            response.err.push(`Failed to parse JSON for key "${key}".`);
                            return null;
                        }
                    }
                }
            }

            return null;
        }

        async function processInlineData(dataItems, domHtml) {
            const apiKey = extractApiKey(domHtml);
            const sessionId = extractSessionId(domHtml);

            if (!apiKey || !sessionId) {
                return;
            }

            const viewerId = extractViewerId(domHtml);
            const csrf = extractCsrf(domHtml);

            // Extract main title.
            const dataTitle = extractHeadline(domHtml);

            for (const dataItem of dataItems) {
                if (!dataItem) {
                    // Skip nullish or empty data items.
                    continue;
                }

                const itemTitle = dataItem.data?.title || dataTitle || '';
                let thumb = '';
                const videoLinks = [];
                const imageLinks = [];
                const itemId = dataItem.data.id || 0;

                // Video links.
                if (dataItem.data?.mediaType === 'video') {
                    const itemKey = dataItem.data.secret || '';

                    if (!itemId || !itemKey) {
                        response.err.push('Cannot extract required parameters, API changed.');
                        continue;
                    }

                    await addVideoLink(videoLinks, itemId, itemKey, apiKey, sessionId, viewerId, csrf);
                }

                // Image links.
                const dataItemLinks = dataItem.data?.sizes?.data;
                if (dataItemLinks && typeof dataItemLinks === 'object' && !Array.isArray(dataItemLinks)) {
                    for (const [key, imageItem] of Object.entries(dataItemLinks)) {
                        let url = imageItem.data?.url || imageItem.data?.displayUrl || '';
                        if (!url) {
                            response.err.push('Cannot extract url, API changed.');
                            continue;
                        }

                        // Fix incomplete URLs: //live.staticflickr.com/295/19478188803_9cebf10911_s.jpg
                        if (!url.startsWith('http')) {
                            url = 'https:' + url;
                        }

                        // Get thumb.
                        if (!thumb || key == 's' || key == 'n') {
                            thumb = url;
                        }

                        // Get quality.
                        let quality = 0;
                        if (imageItem.data.width && imageItem.data.height) {
                            quality = imageItem.data.width + 'x' + imageItem.data.height;
                        }

                        // Link
                        imageLinks.push({
                            url,
                            quality,
                        });
                    }
                }

                if (videoLinks || imageLinks) {
                    // Prepare item URL.
                    const ownerId = dataItem.data.owner?.data?.id || dataItem.data.engagement?.data?.ownerNsid || '';
                    const itemUrl = ownerId && itemId ?
                        `https://www.flickr.com/photos/${ownerId}/${itemId}`
                        : window.location.href;

                    // Add item to response.
                    response.content.push({
                        title: itemTitle,
                        url: itemUrl,
                        thumb,
                        links: [...videoLinks, ...imageLinks],
                    });
                }
            }
        }

        async function processApiData(dataJson, dataKey) {
            const params = new URLSearchParams(window.location.search);

            const apiKey = params.get('api_key');
            if (!apiKey) {
                response.err.push('Cannot get public key.');
                return;
            }

            const sessionId = params.get('reqId');
            if (!sessionId) {
                response.err.push('Cannot get session id.');
                return;
            }

            const csrf = params.get('csrf') || '';
            if (!csrf) {
                response.err.push('Cannot get csrf. URL format changed or user is not logged in.');
            }

            const viewerId = params.get('viewerNSID') || '';
            if (!viewerId) {
                response.err.push('Cannot get viewer id. URL format changed or user is not logged in.');
            }

            // Check if expected data is present.
            if (!Array.isArray(dataJson?.[dataKey]?.photo)) {
                response.err.push('Cannot extract or process images, API changed.');
                return;
            }

            // Usually available quality keys in Flickr API response.
            const qualityArr = ['3k', '4k', 'c', 'h', 'k', 'l', 'm', 'n', 'o', 'q', 's', 'sq', 't', 'w', 'z'];

            // Add links.
            for (const dataItem of dataJson[dataKey].photo) {
                if (!dataItem) {
                    // Skip nullish or empty data items.
                    continue;
                }

                const itemTitle = dataItem.title || dataJson.group?.title || dataJson.photoset?.title || '';
                let thumb = '';
                const videoLinks = [];
                const imageLinks = [];
                const itemId = dataItem.id || 0;

                // Video links.
                if (dataItem.media === 'video') {
                    const itemKey = dataItem.secret || '';

                    if (!itemId || !itemKey) {
                        response.err.push('Cannot extract required parameters, API changed.');
                        continue;
                    }

                    await addVideoLink(videoLinks, itemId, itemKey, apiKey, sessionId, viewerId, csrf);
                }

                // Image links.
                for (const qualityKey of qualityArr) {
                    const url = dataItem['url_' + qualityKey] || dataItem['url_' + qualityKey + '_cdn'] || '';
                    if (!url) {
                        response.err.push(`Cannot extract url for '${qualityKey}'.`);
                        continue;
                    }

                    // Get thumb.
                    if (!thumb || qualityKey == 's' || qualityKey == 'n') {
                        thumb = url;
                    }

                    // Get quality.
                    let quality = 0;
                    if (dataItem['width_' + qualityKey] && dataItem['height_' + qualityKey]) {
                        quality = dataItem['width_' + qualityKey] + 'x' + dataItem['height_' + qualityKey];
                    }

                    // Link
                    imageLinks.push({
                        url,
                        quality,
                    });
                }

                if (videoLinks || imageLinks) {
                    // Prepare item URL.
                    const ownerId = dataItem.owner || dataItem.pathalias || '';
                    const itemUrl = ownerId && itemId ?
                        `https://www.flickr.com/photos/${ownerId}/${itemId}`
                        : window.location.href;

                    // Add item to response.
                    response.content.push({
                        title: itemTitle,
                        url: itemUrl,
                        thumb,
                        links: [...videoLinks, ...imageLinks],
                    });
                }
            }
        }

        async function addVideoLink(videoLinks, photoId, itemKey, apiKey, sessionId, viewerId, csrf) {
            const apiUrl = `https://api.flickr.com/services/rest?photo_id=${photoId}&secret=${itemKey}&viewerNSID=${encodeURIComponent(decodeURIComponent(viewerId))}&method=flickr.video.getStreamInfo&csrf=${encodeURIComponent(decodeURIComponent(csrf))}&api_key=${apiKey}&format=json&hermes=1&hermesClient=1&reqId=${sessionId}&nojsoncallback=1`;

            const fetchRes = await fetch(apiUrl, {
                'mode': 'cors',
                'credentials': 'include'
            });

            if (!fetchRes.ok) {
                response.err.push('Cannot fetch url.');
                return false;
            }

            const videoDataJson = await fetchRes.json();
            if (!videoDataJson) {
                return false;
            }

            if (!Array.isArray(videoDataJson.streams?.stream)) {
                response.err.push('Cannot extract or process streams, API changed.');
                return false;
            }

            for (const stream of videoDataJson.streams.stream) {
                const url = stream._content || '';
                if (!url) {
                    response.err.push('Cannot extract url, API changed.');
                    continue;
                }

                const type = stream.type || '';
                if (type === 'hls') {
                    // Skip M3U8 links.
                    continue;
                }

                let quality = 0;
                if (type === 'appletv') {
                    quality = 'HD';
                } else if (type == 700) {
                    quality = 'SD';
                } else if (type == 'iphone_wifi') {
                    quality = 'SD';
                }

                // Link
                videoLinks.push({
                    url,
                    quality,
                    type: 'video',
                });
            }
        }

        async function extractHeadline(domHtml) {
            const headline = domHtml.match(/"headline":\s*"([^"]+)/)?.[1] || ''
            if (!headline) {
                response.err.push('Cannot extract headline, DOM changed.');
            }

            return headline;
        }

        function extractApiKey(domHtml) {
            const apiKey = domHtml.match(/flickr\.api\.site_key\s*=\s*"([^"]+)/)?.[1] || '';

            if (!apiKey) {
                response.err.push('Cannot extract public key.');
            }

            return apiKey;
        }

        function extractSessionId(domHtml) {
            const sessionId = domHtml.match(/root\.reqId\s*=\s*"([^"]+)/)?.[1] || '';

            if (!sessionId) {
                response.err.push('Cannot extract session.');
            }

            return sessionId;
        }

        function extractCsrf(domHtml) {
            const csrf = domHtml.match(/"csrf":\s*"([^"]+)/)?.[1] || '';

            if (!csrf) {
                response.err.push('CSRF is missing, DOM changed or user is not logged in.');
            }

            return csrf;
        }

        function extractViewerId(domHtml) {
            const viewerId = domHtml.match(/("viewerNsid":|"user":{"nsid":)\s*"([^"]+)/)?.[2] || '';

            if (!viewerId) {
                response.err.push('Viewer ID is missing, DOM changed or user is not logged in.');
            }

            return viewerId;
        }

        // Ensure to resolve.
        setTimeout(() => {
            resolve(response);
        }, 20000);
    });
}

//     console.log(await SB_go());
// })();
