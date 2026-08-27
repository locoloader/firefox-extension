// (async () => {
    function SB_go(lejp = '') {
        return new Promise((resolve) => {
            const response = {
                err: [],
                content: [],
                nextUrl: [],
            };

            // Create object from LEJP.
            const payload = lejp ? JSON.parse(lejp) || null : null;

            // Get page URL.
            const url = window.location.href;

            // Determine content type by URL.
            let interceptionRegExp;
            let contentType;

            if (payload?.contentType === 'gallery') {
                contentType = payload.contentType;
                interceptionRegExp = new RegExp(`/api/v1/mediaoffers/location\\?`);
            } else if (/\/post\/(\d+)/.test(url)) {
                contentType = 'post';
                interceptionRegExp = new RegExp(`/api/v1/post\\?`);
            } else if (/\/media($|\?|\/|\&)|\/messages\/\d+\/gallery/.test(url)) {
                contentType = 'media';
                interceptionRegExp = new RegExp(`/api/v1/mediaoffers/location\\?`);
            } else if (/\/messages\//.test(url)) {
                contentType = 'messages';
                interceptionRegExp = new RegExp(`/api/v1/message\\?groupId=`);
            } else if (/\/explore\/foryou/.test(url)) {
                contentType = 'foryou';
                interceptionRegExp = new RegExp(`/api/v1/contentdiscovery/media/suggestionsnew`);
            } else {
                response.err.push('Unsupported URL.');
                resolve(response);
                return;
            }

            function sleep(ms = 1000) {
                return new Promise((resolve) => {
                    setTimeout(resolve, ms);
                });
            }

            // Browser automation
            // ------------------

            async function getElement(selector, maxAttempts = 8) {
                const el = document.querySelector(selector);
                maxAttempts--;

                if (!el) {
                    if (!maxAttempts) {
                        response.err.push(`Element ${selector} not found.`);
                        return el;
                    }

                    await sleep(125);

                    return await getElement(selector, maxAttempts);
                } else {
                    return el;
                }
            }

            function getElementCb(selector, callback, maxAttempts = 8) {
                const el = document.querySelector(selector);
                maxAttempts--;

                if (!el) {
                    if (!maxAttempts) {
                        response.err.push(`Element ${selector} not found.`);
                        return callback(null);
                    }

                    // Pass the function and its arguments directly to setTimeout
                    setTimeout(getElementCb, 125, selector, callback, maxAttempts);
                } else {
                    callback(el);
                }
            }

            if (contentType === 'gallery') {
                getElementCb('div[class~="gallery-hot-icon"]', (el) => {
                    el?.click();
                });
            }

            // Scroll
            let maxNumOfScrolls = 6;

            async function scrollPage() {
                maxNumOfScrolls--;

                const el = await getElement('html');

                el.scrollTo({
                    top: 0,
                    behavior: 'instant',
                });
                el.scrollTop = 0;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));

                await sleep(100);

                el.scrollTo({
                    top: el.scrollHeight,
                    behavior: 'instant',
                });
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));

                await sleep(100);

                el.scrollTo({
                    top: el.scrollHeight,
                    behavior: 'instant',
                });
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));
            }

            async function scrollMessages() {
                maxNumOfScrolls--;

                const el = await getElement('div[class~="message-content-list"]');

                el.scrollTo({
                    top: el.scrollHeight,
                    behavior: 'instant',
                });
                el.scrollTop = 0;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));

                await sleep(100);

                el.scrollTo({
                    top: 0,
                    behavior: 'instant',
                });
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));
            }

            async function scrollGallery() {
                maxNumOfScrolls--;

                const el = await getElement('div[class~="view-list"]');

                el.scrollTo({
                    top: 0,
                    behavior: 'instant',
                });
                el.scrollTop = 0;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));

                await sleep(100);

                el.scrollTo({
                    top: el.scrollHeight,
                    behavior: 'instant',
                });
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));

                await sleep(100);

                el.scrollTo({
                    top: el.scrollHeight,
                    behavior: 'instant',
                });
                el.scrollTop = el.scrollHeight;
                el.dispatchEvent(new Event('scroll', { bubbles: true }));
            }

            async function scrollForYou() {
                maxNumOfScrolls--;

                const html = await getElement('html');

                for (let i = 0; i < 10; i++) {
                    html.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'ArrowDown',
                        code: 'ArrowDown',
                        keyCode: 40,
                        which: 40,
                        bubbles: true,
                    }));

                    await sleep(500);
                }
            }

            // Common Code for Extractors
            // --------------------------

            // Map of all extracted/loaded media objects.
            // id: string, media: object
            const extractedMedia = new Map();

            // Aggregated media IDs to load. Used to reduce API calls to one.
            // <id: string, title: string>
            const mediaIdToLoad = new Map();

            // Set of media IDs already added to reponse. Used to prevent duplicates.
            const addedMedia = new Set();

            /**
             * Add final URL to response from provided title and media object.
             * @param {string} title
             * @param {object} media
             */
            async function addFinalUrl(title, media) {
                if (media.id === undefined) {
                    response.err.push("Property 'id' is missing.");
                    return;
                }

                if (addedMedia.has(media.id)) {
                    return;
                }

                const finalUrl = {
                    title,
                    thumb: '',
                    links: [],
                };

                // Set of added final links. Used to prevent duplicates.
                const addedLinks = new Set();

                // Extract media preview.
                if (media.preview) {
                    await extractVariant(media.preview, finalUrl, addedLinks);
                } else {
                    response.err.push("Property 'preview' is missing.");
                }

                // Extract media preview variants.
                if (Array.isArray(media.preview?.variants)) {
                    for (const variant of media.preview.variants) {
                        await extractVariant(variant, finalUrl, addedLinks);
                    }
                } else {
                    response.err.push("Property 'media.preview.variants' is missing or not array.");
                }

                // Extract media root.
                if (media.media) {
                    await extractVariant(media.media, finalUrl, addedLinks);
                } else {
                    response.err.push("Property 'media' is missing.");
                }

                // Extract media variants.
                if (Array.isArray(media.media?.variants)) {
                    for (const variant of media.media.variants) {
                        await extractVariant(variant, finalUrl, addedLinks);
                    }
                } else {
                    response.err.push("Property 'media.media.variants' is missing or not array.");
                }

                if (finalUrl.links.length) {
                    addedMedia.add(media.id);
                    response.content.push(finalUrl);
                } else {
                    response.err.push('No links were extracted.');
                }
            }

            async function extractVariant(variant, finalUrl, addedLinks) {
                if (!Array.isArray(variant.locations)) {
                    response.err.push("Property 'locations' is missing or not array.");
                    return;
                }

                for (const location of variant.locations) {
                    if (location.location) {
                        // Avoid duplicates.
                        if (addedLinks.has(location.location)) {
                            continue;
                        } else {
                            addedLinks.add(location.location);
                        }

                        // Prepare query string.
                        const qs = location.metadata ? '?' + new URLSearchParams(location.metadata).toString() : '';

                        // Set thumb.
                        if (variant.type !== 4 && variant.mimetype?.match(/^image\//)) {
                            // Last image has lowest resolution, so it is best for thumb.
                            // Type 3 images are blurred.
                            if (!(variant.type === 3 && finalUrl.thumb)) {
                                // Use blurred thumb only when no better thumb is set.
                                finalUrl.thumb = location.location + qs;
                            }
                        }

                        // Get array with link objects from provided link data.
                        const links = await getLinks(
                            location.location,
                            qs,
                            variant.mimetype,
                            variant.width,
                            variant.height,
                        );

                        for (const link of links) {
                            // Add link
                            finalUrl.links.push({
                                width: link.width,
                                height: link.height,
                                mime: link.mime,
                                url: link.url,
                                raw: link.raw || '',
                            });
                        }
                    }
                }
            }

            /**
             * Prepare link objects from link data.
             * @param {string} url
             * @param {string} qs
             * @param {string} mime
             * @param {number} width
             * @param {number} height
             * @returns
             */
            async function getLinks(url, qs, mime, width, height) {
                const links = [];

                if (mime !== 'application/vnd.apple.mpegurl') {
                    return [
                        {
                            url: url + qs,
                            mime: mime || '',
                            width: width || 0,
                            height: height || 0,
                        },
                    ];
                }

                let fetchRes = await fetchUrl(url + qs, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'include',
                });
                if (!fetchRes) {
                    return;
                }

                fetchRes = await fetchRes.text();

                const streams = fetchRes.matchAll(/RESOLUTION=(\d+)x(\d+).+?(media-\d+\/stream\.m3u8)/gs);

                if (!streams) {
                    response.err.push("Extraction error: Can't extract M3U8 streams.");
                    return [
                        {
                            url: url + qs,
                            mime: mime || '',
                            width: width || 0,
                            height: height || 0,
                        },
                    ];
                }

                for (const stream of streams) {
                    const streamUrl = url.replace(/\d+\.m3u8/, stream[3]) + qs;

                    let fetchRes = await fetchUrl(streamUrl, {
                        method: 'GET',
                        mode: 'cors',
                        credentials: 'include',
                    });
                    if (!fetchRes) {
                        return [
                            {
                                url: url + qs,
                                mime: mime || '',
                                width: width || 0,
                                height: height || 0,
                            },
                        ];
                    }

                    links.push({
                        url: streamUrl,
                        raw: btoa(await fetchRes.text()),
                        mime: mime,
                        width: stream[1] || 0,
                        height: stream[2] || 0,
                    });

                    // Use only first (best quality) stream.
                    break;
                }

                return links;
            }

            // Process API JSON response.
            async function processResponseJson(json) {
                if (contentType === 'post') {
                    await processMediaMap(await processApiResponse(contentType, json?.response || {}, extractedMedia));
                    return true;
                } else if (contentType === 'media') {
                    const hasMore = await extractMedia(json);
                    if (hasMore && maxNumOfScrolls) {
                        await scrollPage();
                        return false;
                    } else {
                        return true;
                    }
                } else if (contentType === 'gallery') {
                    const hasMore = await extractMedia(json);
                    if (hasMore && maxNumOfScrolls) {
                        await scrollGallery();
                        return false;
                    } else {
                        return true;
                    }
                } else if (contentType === 'messages') {
                    await processMediaMap(await processApiResponse(contentType, json?.response || {}, extractedMedia));
                    const hasMore = json?.response?.messages?.length >= 25;
                    if (hasMore && maxNumOfScrolls) {
                        await scrollMessages();
                        return false;
                    } else {
                        return true;
                    }
                } else if (contentType === 'foryou') {
                    await extractForYou(json);
                    if (maxNumOfScrolls) {
                        await scrollForYou();
                        return false;
                    } else {
                        return true;
                    }
                } else {
                    return true;
                }
            }

            // Posts and Messages Extractor
            // ----------------------------

            // Sets of IDs already added to reponse. Used to prevent duplicates.
            const addedPosts = new Set();

            /**
             * @param {Array} postIds
             * @returns
             */
            async function loadPosts(postIds) {
                const posts = await fetchApi(`https://apiv3.fansly.com/api/v1/post?ids=${postIds.join(',')}&ngsw-bypass=true`);

                if (posts?.response === undefined) {
                    response.err.push("Property 'response' is missing.");
                }

                return posts?.response || false;
            }

            /**
             * @param {string} contentType
             * @param {object} data 'response' property of JSON API response.
             * @param {Map<string, object>} extractedMedia
             * @param {Map<string, {title: string, mediaIdSet: Set<number>}>} mediaMap
             * @returns Returns media map.
             */
            async function processApiResponse(contentType, data, extractedMedia, mediaMap = new Map()) {
                if (contentType === 'post' && (data.posts === undefined || !Array.isArray(data.posts))) {
                    response.err.push("Property 'posts' is missing or not array(xd).");
                    return mediaMap;
                }

                if (contentType === 'messages' && (data.messages === undefined || !Array.isArray(data.messages))) {
                    response.err.push("Property 'messages' is missing or not array.");
                    return mediaMap;
                }

                if (data.accountMedia === undefined || !Array.isArray(data.accountMedia)) {
                    response.err.push("Property 'accountMedia' is missing or not array.");
                    return mediaMap;
                }

                for (const accountMedia of data.accountMedia) {
                    if (!accountMedia.id) {
                        response.err.push("Property 'accountMedia[*].id' is empty or missing.");
                        continue;
                    }

                    extractedMedia.set(accountMedia.id, accountMedia);
                }

                // Collect all post, message, or foryou media IDs to extract.
                let items = [];
                let errMsgPropName = 'posts';
                switch (contentType) {
                    case 'post':
                        items = data.posts;
                        break;
                    case 'messages':
                        items = data.messages;
                        errMsgPropName = 'messages';
                        break;
                }

                for (const item of items) {
                    if (item.id === undefined) {
                        response.err.push(`Property '${errMsgPropName}[*].id' is missing.`);
                        continue;
                    }

                    if (contentType === 'post') {
                        addedPosts.add(item.id);
                    }

                    if (item.content === undefined) {
                        response.err.push(`Property '${errMsgPropName}[*].content' is missing.`);
                    }

                    if (item.attachments === undefined) {
                        response.err.push(`Property '${errMsgPropName}[*].attachments' is missing.`);
                        continue;
                    }

                    for (const attachment of item.attachments) {
                        if (!attachment.contentId) {
                            response.err.push(`Property '${errMsgPropName}[*].attachments[*].contentId' is empty or missing.`);
                            continue;
                        }

                        if (attachment.contentType === undefined) {
                            response.err.push(`Property '${errMsgPropName}[*].attachments[*].contentType' is missing.`);
                            continue;
                        }

                        if (attachment.contentType === 8) {
                            // Skip aggregated posts.
                            continue;
                        }

                        // Collect media IDs from attachments.
                        const mediaObj = mediaMap.get(item.id);
                        mediaObj?.mediaIdSet?.add(attachment.contentId) ||
                            mediaMap.set(item.id, {
                                title: item.content || '',
                                mediaIdSet: new Set([attachment.contentId]),
                            });

                        // Collect media IDs from account media bundles.
                        if (data.accountMediaBundles === undefined || !Array.isArray(data.accountMediaBundles)) {
                            response.err.push("Property 'accountMediaBundles' is missing or not array.");
                            continue;
                        }

                        for (const accountMediaBundle of data.accountMediaBundles) {
                            if (!accountMediaBundle.id) {
                                response.err.push("Property 'accountMediaBundles[*].id' is empty or missing.");
                                continue;
                            }

                            if (
                                accountMediaBundle.accountMediaIds === undefined ||
                                !Array.isArray(accountMediaBundle.accountMediaIds)
                            ) {
                                response.err.push(
                                    "Property 'accountMediaBundles[*].accountMediaIds' is missing or not array.",
                                );
                                continue;
                            }

                            if (accountMediaBundle.id === attachment.contentId) {
                                for (const mediaId of accountMediaBundle.accountMediaIds) {
                                    const postObj = mediaMap.get(item.id);
                                    postObj?.mediaIdSet?.add(mediaId) ||
                                        mediaMap.set(item.id, {
                                            title: item.content || '',
                                            mediaIdSet: new Set([mediaId]),
                                        });
                                }
                            }
                        }
                    }
                }

                // Load and extract aggregated posts.
                if (contentType === 'post') {
                    if (data.aggregatedPosts === undefined || !Array.isArray(data.aggregatedPosts)) {
                        response.err.push("Property 'aggregatedPosts' is missing or not array.");
                        return mediaMap;
                    }

                    const aggPostIds = [];
                    for (const aggregatedPost of data.aggregatedPosts) {
                        if (aggregatedPost.id === undefined) {
                            response.err.push("Property 'aggregatedPosts[*].id' is missing.");
                            continue;
                        }

                        if (addedPosts.has(aggregatedPost.id)) {
                            continue;
                        }

                        aggPostIds.push(aggregatedPost.id);
                    }

                    if (aggPostIds.length) {
                        const posts = await loadPosts(aggPostIds);
                        if (posts) {
                            mediaMap = await processApiResponse(contentType, posts, extractedMedia, mediaMap);
                        }
                    }
                }

                return mediaMap;
            }

            /**
             * @param {Map<string, {title: string, mediaIdSet: Set<number>}>} mediaMap
             */
            async function processMediaMap(mediaMap) {
                for (const [mediaId, mediaObj] of mediaMap) {
                    for (const mediaId of mediaObj.mediaIdSet) {
                        if (extractedMedia.has(mediaId)) {
                            // Each media represents one final URL.
                            await addFinalUrl(mediaObj.title, extractedMedia.get(mediaId));
                        } else {
                            // Media is missing, load it later.
                            mediaIdToLoad.set(mediaId, mediaObj.title);
                        }
                    }
                }
            }

            // Media Extractor
            // ---------------

            async function loadAndProcessMissingMedia() {
                if (mediaIdToLoad.size) {
                    // Create array of media ids chunked by chunk size.
                    const mediaIdChunks = [];
                    for (const mediaId of mediaIdToLoad.keys()) {
                        if (!mediaIdChunks.length || mediaIdChunks[mediaIdChunks.length - 1].length === 99) {
                            mediaIdChunks.push([mediaId]);
                        } else {
                            mediaIdChunks[mediaIdChunks.length - 1].push(mediaId);
                        }
                    }

                    for (const mediaIdChunk of mediaIdChunks) {
                        // Load missing media.
                        const mediaRes = await fetchApi(
                            `https://apiv3.fansly.com/api/v1/account/media?ids=${mediaIdChunk.join(',')}&ngsw-bypass=true`,
                        );
                        if (!mediaRes) {
                            continue;
                        }

                        if (mediaRes.response === undefined || !Array.isArray(mediaRes.response)) {
                            response.err.push("Property 'response' is missing or not array.");
                            continue;
                        }

                        for (const media of mediaRes.response) {
                            // Each media represents one final URL.
                            await addFinalUrl(mediaIdToLoad.get(media.id) || '', media);
                        }

                        // Sleep 500-1000ms between each request.
                        await sleep(Math.floor(Math.random() * 501) + 500);
                    }

                    // Clear already loaded media.
                    mediaIdToLoad.clear();
                }
            }

            // Returns true if more media is available.
            async function extractMedia(data) {
                if (
                    data.response.aggregationData.posts &&
                    Array.isArray(data.response.aggregationData.posts) &&
                    data.response.aggregationData.posts.length > 0
                ) {
                    // Extract posts.
                    await processMediaMap(await processApiResponse('post', data.response.aggregationData, extractedMedia));
                }

                if (
                    !data.response.aggregationData.accountMedia ||
                    !Array.isArray(data.response.aggregationData.accountMedia)
                ) {
                    response.err.push("Property 'response.aggregationData.accountMedia' is missing or not array.");
                } else {
                    // Extract media.
                    for (const accountMedia of data.response.aggregationData.accountMedia) {
                        if (!accountMedia.id) {
                            response.err.push("Property 'response.accountMedia[*].id' is empty or missing.");
                            continue;
                        }

                        await addFinalUrl('', accountMedia);
                    }
                }

                if (
                    !data.response.aggregationData.accountMediaBundles ||
                    !Array.isArray(data.response.aggregationData.accountMediaBundles)
                ) {
                    response.err.push(
                        "Property 'response.aggregationData.accountMediaBundles' is missing or not array.",
                    );
                } else {
                    // Extract media IDs to load.
                    for (const accountMediaBundle of data.response.aggregationData.accountMediaBundles) {
                        if (!accountMediaBundle.id) {
                            response.err.push(
                                "Property 'response.aggregationData.accountMediaBundles[*].id' is empty or missing.",
                            );
                            continue;
                        }

                        if (
                            accountMediaBundle.accountMediaIds === undefined ||
                            !Array.isArray(accountMediaBundle.accountMediaIds)
                        ) {
                            response.err.push(
                                "Property 'response.aggregationData.accountMediaBundles[*].accountMediaIds' is missing or not array.",
                            );
                            continue;
                        }

                        for (const mediaId of accountMediaBundle.accountMediaIds) {
                            if (!extractedMedia.has(mediaId)) {
                                mediaIdToLoad.set(mediaId, '');
                            }
                        }
                    }
                }

                if (data.response.data === undefined || !Array.isArray(data.response.data)) {
                    response.err.push("Property 'response.data' is empty or not array.");
                } else if (data.response.data.length >= 29 && data.response.data[data.response.data.length - 1].id) {
                    // More data is available.
                    return true;
                }

                return false;
            }

            // For You Extractor
            // -----------------
            async function extractForYou(data) {
                if (
                    data.response.aggregationData.posts &&
                    Array.isArray(data.response.aggregationData.posts) &&
                    data.response.aggregationData.posts.length > 0
                ) {
                    // Extract posts.
                    await processMediaMap(await processApiResponse('post', data.response.aggregationData, extractedMedia));
                } else {
                    response.err.push("Property 'response.aggregationData.posts' is missing or not array.");
                }
            }

            // XHR
            // ---
            const httpOpen = XMLHttpRequest.prototype.open;
            const httpSend = XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
                this._requestUrl = url;
                return httpOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function (body) {
                this.addEventListener('load', async function () {
                    if (interceptionRegExp.test(this._requestUrl)) {
                        try {
                            const shouldResolve = await processResponseJson(JSON.parse(this.response));
                            if (shouldResolve) {
                                // Remove monkey-patch.
                                XMLHttpRequest.prototype.open = httpOpen;
                                XMLHttpRequest.prototype.send = httpSend;

                                // Load and add missing media to response.
                                await loadAndProcessMissingMedia();

                                // Return response.
                                resolve(response);
                            }
                        } catch (e) {
                            response.err.push('Probably cannot parse JSON.');
                        }
                    }
                });

                return httpSend.apply(this, arguments);
            };

            // Fetch
            // -----
            function getToken() {
                // Try getting token from document body.
                const token = document.cookie.match(/f-s-c=([^;]+)/);
                if (token?.[1]) {
                    return token[1];
                }

                // Try getting token from local storage.
                const session = JSON.parse(localStorage.getItem('session_active_session'));
                if (session?.token) {
                    return session?.token;
                }

                response.err.push("Can't extract token.");
                return '';
            }

            function getSessionId() {
                const session = JSON.parse(localStorage.getItem('session_active_session'));
                return session?.id || '';
            }

            function getDeviceId() {
                return localStorage.getItem('device_device_id');
            }

            function getClientTs() {
                const now = Date.now();
                const randomValue = Math.floor(Math.random() * 10000);
                return now + (5000 - randomValue);
            }

            async function fetchApi(url) {
                const deviceId = getDeviceId();
                const sessionId = getSessionId();
                const token = getToken();
                const headers = new Map();

                headers.set('accept', 'application/json, text/plain, */*');

                if (token) {
                    headers.set('authorization', token);
                }

                if (deviceId) {
                    headers.set('fansly-client-id', deviceId);
                }

                headers.set('fansly-client-ts', getClientTs());

                if (sessionId) {
                    headers.set('fansly-session-id', sessionId);
                }

                const res = await fetchUrl(url, {
                    credentials: 'same-origin', // include, same-origin
                    headers: Object.fromEntries(headers),
                });

                await sleep(250);

                if (res) {
                    return structuredClone(await res.json());
                } else {
                    response.err.push('Unexpected API fetch response.');
                }

                return res;
            }

            async function fetchUrl(url, options = {}) {
                let fetchRes;

                try {
                    fetchRes = await fetch(url, options);

                    if (!fetchRes.ok) {
                        throw new Error(`Fetch error: ${fetchRes.status}`);
                    }
                } catch (err) {
                    response.err.push(`Fetch error: ${err.message}`);
                }

                return fetchRes?.ok ? fetchRes : false;
            }

            // Ensure to resolve.
            setTimeout(() => {
                resolve(response);
            }, contentType === 'foryou' ? 60000 : 20000);
        });
    }

//     console.log(await SB_go());
// })();
