function SB_go() {
    return new Promise((resolve) => {
        // Data to return.
        const response = {
            'err': [],
            'content': [],
            'nextUrl': [],
        };

        // Get page URL.
        const url = window.location.href;

        // Extract chat ID from URL.
        const chatId = url.match(/\/chat\/(\d+)/)?.[1] || '';

        // Determine content type by URL.
        let interceptionRegExp;
        let contentType = 'chat-media';
        if (/\/chat\/(\d+)\/gallery\/videos/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media/videos`);
        } else if (/\/chat\/(\d+)\/gallery\/photos/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media/photos`);
        } else if (/\/chat\/(\d+)\/gallery\/audios/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media/audios`);
        } else if (/\/chat\/(\d+)\/gallery\/opened/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media/?.*opened=1`);
        } else if (/\/chat\/(\d+)\/gallery\/purchased/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media/?.*purchased=1`);
        } else if (/\/chat\/(\d+)\/gallery/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/media`);
        } else if (/\/chat\/(\d+)/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/chats/${chatId}/messages`);
            contentType = 'chat';
        } else if (/\/[^\/]+\/media/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/users/\\d+/posts/medias`);
            contentType = 'media';
        } else if (/\/[^\/]+\/photos/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/users/\\d+/posts/photos`);
            contentType = 'media';
        } else if (/\/[^\/]+\/videos/.test(url)) {
            interceptionRegExp = new RegExp(`/api2/v2/users/\\d+/posts/videos`);
            contentType = 'media';
        } else {
            response.err.push('Unsupported URL.');
            resolve(response);
            return;
        }

        // If chat ID is required, check if it is extracted.
        if (contentType.startsWith('chat') && !chatId) {
            response.err.push('Cannot extract chat ID.');
            resolve(response);
            return;
        }

        // Scroll.
        let maxNumOfScrolls = 9;
        if (contentType === 'chat') {
            maxNumOfScrolls = 12;
        }

        async function getElement(selector, maxAttempts = 8) {
            const el = document.querySelector(selector);
            maxAttempts--;

            if (!el) {
                if (!maxAttempts) {
                    response.err.push(`Element ${selector} not found.`);
                    return el;
                }

                await new Promise(resolve => setTimeout(resolve, 125));

                return await getElement(selector, maxAttempts);
            } else {
                return el;
            }
        }

        async function scrollFeed() {
            const feed = await getElement('div[at-attr="feed_content"]');

            await new Promise(resolve => setTimeout(resolve, 50));

            maxNumOfScrolls--;

            feed.scrollTo({ top: feed.scrollHeight, behavior: 'instant' });
            feed.dispatchEvent(new Event('scroll', { bubbles: true }));
        }

        async function scrollMessages() {
            const feed = await getElement('div[class~="b-chats__scrollbar"]');

            await new Promise(resolve => setTimeout(resolve, 50));

            maxNumOfScrolls--;

            feed.scrollTo({ top: 0, behavior: 'instant' });
            feed.dispatchEvent(new Event('scroll', { bubbles: true }));
        }

        async function scrollPage() {
            const page = await getElement('div[class~="l-profile-page"]', 40);

            await new Promise(resolve => setTimeout(resolve, 50));

            maxNumOfScrolls--;

            window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: 'instant' });
            window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }

        if (contentType === 'media') {
            (async () => {
                await scrollPage();
            })();
        }

        // Monkey-patch XHR.
        const httpOpen = XMLHttpRequest.prototype.open;
        const httpSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
            this._requestUrl = url;
            return httpOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function (body) {
            this.addEventListener('load', async function () {
                if (interceptionRegExp.test(this._requestUrl)) {
                    // Read body of specific requests.
                    try {
                        const data = JSON.parse(this.response);

                        extractData(data);

                        if (data.hasMore && maxNumOfScrolls) {
                            if (contentType === 'chat-media') {
                                await scrollFeed();
                            }

                            if (contentType === 'chat') {
                                await scrollMessages();
                            }

                            if (contentType === 'media') {
                                await scrollPage();
                            }
                        } else {
                            resolve(response);
                        }
                    } catch (e) {
                        response.err.push('Probably cannot parse JSON.');
                        resolve(response);
                    }
                }
            });

            return httpSend.apply(this, arguments);
        }

        // Monkey-patch fetch.
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            // Extract the URL.
            const resource = args[0];
            let requestUrl = '';

            if (typeof resource === 'string') {
                requestUrl = resource;
            } else if (resource instanceof URL) {
                requestUrl = resource.href;
            } else if (resource instanceof Request) {
                requestUrl = resource.url;
            }

            // Execute network request.
            const res = await originalFetch(...args);

            if (interceptionRegExp.test(requestUrl)) {
                // Read body of specific requests.
                const resClone = res.clone();
                try {
                    const data = await resClone.json();

                    extractData(data);

                    if (data.hasMore && maxNumOfScrolls) {
                        if (contentType === 'chat-media') {
                            await scrollFeed();
                        }

                        if (contentType === 'chat') {
                            await scrollMessages();
                        }

                        if (contentType === 'media') {
                                await scrollPage();
                            }
                    } else {
                        resolve(response);
                    }
                } catch (e) {
                    response.err.push('Probably cannot parse JSON.');
                    resolve(response);
                }
            }

            return res;
        };

        // Extracts data from API response JSON and adds them to scraper response.
        function extractData(data) {
            if (!data.list) {
                if (data.list === undefined) {
                    response.err.push('Property \'list\' is missing, API changed.');
                }
                return;
            }

            if (!Array.isArray(data.list)) {
                return;
            }

            for (const message of data.list) {
                if (!message.media) {
                    if (message.media === undefined) {
                        response.err.push('Property \'list.media\' is missing, API changed.');
                    }
                    continue;
                }

                if (!Array.isArray(message.media)) {
                    continue;
                }

                // Get url
                const url = window.location.href;

                // Extract title
                let title = message.text;
                if (title === undefined) {
                    response.err.push('Property \'list[].text\' is missing, API changed.');
                    title = '';
                }

                for (const mediaItem of message.media) {
                    // Extract media link
                    const link = mediaItem.files?.full?.url;
                    if (!link) {
                        // Link may be null, because user does not have access to it.
                        if (link === undefined) {
                            response.err.push('Property \'list[].media[].files.full.url\' is missing, API changed.');
                        }
                        continue;
                    }

                    // Extract video sources
                    const links = [];
                    if (mediaItem.videoSources && typeof mediaItem.videoSources === 'object') {
                        for (const [height, url] of Object.entries(mediaItem.videoSources)) {
                            if (url) {
                                links.push({
                                    link: url,
                                    mediaType: 'video',
                                    width: 0,
                                    height,
                                });
                            }
                        }
                    }

                    // Extract media quality
                    let width = mediaItem.files?.full?.width;
                    let height = mediaItem.files?.full?.height;
                    if (width === undefined) {
                        response.err.push('Property \'list[].media[].files.full.width\' is missing, API changed.');
                        width = 0;
                    }
                    if (height === undefined) {
                        response.err.push('Property \'list[].media[].files.full.height\' is missing, API changed.');
                        height = 0;
                    }

                    // Extract media thumb
                    let thumb = mediaItem.files?.thumb?.url;
                    if (thumb === undefined) {
                        response.err.push('Property \'list[].media[].files.thumb.url\' is missing, API changed.');
                        thumb = '';
                    }

                    // Extract media type
                    let mediaType = mediaItem.type;
                    if (mediaType === undefined) {
                        response.err.push('Property \'list[].media[].files.mediaType\' is missing, API changed.');
                        mediaType = '';
                    }

                    // Add final URL to response.
                    response.content.push({
                        title,
                        thumb,
                        url,
                        links: [{
                            link,
                            mediaType,
                            width,
                            height,
                        }, ...links]
                    });
                }
            }
        }

        // Ensure to resolve.
        setTimeout(() => {
            resolve(response);
        }, contentType === 'chat' ? 30000 : 20000);
    });
}
