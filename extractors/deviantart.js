// (async () => {
async function SB_go() {
    const response = {
        err: [],
        content: [],
        nextUrl: [],
    };

    const extractedTitles = new Map();

    function getContentType(el) {
        if (
            el.querySelector('span[aria-label="stack of images"]') ||
            el.querySelector('span[aria-label="Pila de imágenes"]') ||
            el.querySelector('span[aria-label="Bilderstapel"]') ||
            el.querySelector('span[aria-label="pile d\'images"]') ||
            el.querySelector('span[aria-label="pilha de imagens"]') ||
            el.querySelector('span[aria-label="stapel met afbeeldingen"]')
        ) {
            const imgElement = el.querySelector('img');
            // if (imgElement && imgElement.getAttribute('src').includes(',blur_')) {
            //     return 'locked';
            // }

            return 'collection';
        }

        const divElements = el.querySelectorAll('div');
        for (const divElement of divElements) {
            if (divElement.innerText.match(/^\d+:\d+$/)) {
                return 'video';
            }
        }

        const imgElement = el.querySelector('img');
        if (imgElement) {
            // if (imgElement.getAttribute('src').includes(',blur_')) {
            //     return 'locked';
            // }

            return 'image';
        }

        if (el.querySelector('div').innerText == 'Literature') {
            return 'literature';
        }

        return '';
    }

    function getUrlType(url) {
        if (url.match(/deviantart\.com\/[^\/]+\/art(\/|\?)?|deviantart\.com\/stash\//)) {
            return 'art';
        }

        if (url.match(/deviantart\.com\/[^\/]+\/(gallery|favourites)(\/|\?)?/)) {
            return 'gallery';
        }

        response.err.push('Cannot determine URL type.');
        return '';
    }

    async function fetchPageHtml(url) {
        const res = await fetch(url);

        if (!res.ok) {
            response.err.push('Cannot fetch url.');
            return '';
        }

        return await res.text();
    }

    function extractDeviations(initialStateJson, pageUrl) {
        for (const deviationId in initialStateJson['@@entities'].deviation) {
            extractDeviationById(initialStateJson, deviationId, pageUrl);
        }
    }

    async function extractDeviationsByIds(initialStateJson, deviationIds, pageUrl) {
        for (const deviationId in deviationIds.id) {
            // If we extract deviations from gallery page, fetch initialStateJson from collection pages
            if (deviationIds.id[deviationId].type == 'collection') {
                const html = await fetchPageHtml(deviationIds.id[deviationId].url);
                if (!html) return;

                const collectionInitialStateJson = extractInitialJsonFromPageHtml(html);
                if (collectionInitialStateJson) {
                    extractDeviationById(collectionInitialStateJson, deviationId, pageUrl);
                }
            } else {
                extractDeviationById(initialStateJson, deviationId, pageUrl);
            }
        }
    }

    function extractDeviationById(initialStateJson, deviationId, pageUrl) {
        if (initialStateJson['@@entities'].deviation[deviationId]) {
            if (typeof initialStateJson['@@entities'].deviation[deviationId].media === 'undefined') {
                response.err.push('Property @@entities.deviation[' + deviationId + '].media is missing, API changed.');
                return;
            }

            // Extract title.
            let title = 'Untitled';
            if (typeof initialStateJson['@@entities'].deviation[deviationId].title === 'undefined') {
                response.err.push('Property @@entities.deviation[id].title is missing, API changed.');
            } else {
                title = initialStateJson['@@entities'].deviation[deviationId].title;
            }

            // Extract deviation media.
            extractMedia(title, initialStateJson['@@entities'].deviation[deviationId].media, pageUrl);

            // Extract deviation extended media.
            if (initialStateJson['@@entities'].deviationExtended) {
                if (!initialStateJson['@@entities'].deviationExtended[deviationId]) {
                    response.err.push('Property @@entities.deviationExtended[' + deviationId + '] is missing.');
                    return;
                }

                if (
                    typeof initialStateJson['@@entities'].deviationExtended[deviationId].additionalMedia === 'undefined'
                ) {
                    response.err.push(
                        'Property @@entities.deviationExtended[' +
                            deviationId +
                            '].additionalMedia is missing. Post does not include any additional media or API changed.',
                    );
                    return;
                }

                for (const additionalMedia of initialStateJson['@@entities'].deviationExtended[deviationId]
                    .additionalMedia) {
                    if (typeof additionalMedia.media === 'undefined') {
                        response.err.push(
                            'Property @@entities.deviationExtended[' +
                                deviationId +
                                '].additionalMedia[i].media is missing, API changed.',
                        );
                        return;
                    }

                    extractMedia(title, additionalMedia.media, pageUrl);
                }
            }
        } else {
            response.err.push('Property @@entities.deviation[' + deviationId + '] is missing.');
        }
    }

    function extractMedia(title, media, pageUrl) {
        if (typeof media.types === 'undefined') {
            response.err.push('Property media.types is missing, API changed.');
            return;
        }

        // Set and update title number
        if (extractedTitles.has(title)) {
            let titleNum = extractedTitles.get(title);
            titleNum++;
            extractedTitles.set(title, titleNum);
            title = title + ' #' + titleNum;
        } else {
            extractedTitles.set(title, 1);
        }

        let thumbObj;
        const images = [];
        const videos = [];

        for (const mediaType of media.types) {
            if (typeof mediaType.t === 'undefined') {
                response.err.push('Property media.types[i].t is missing, API changed.');
                continue;
            }

            // Extract thumb
            if (!thumbObj && (mediaType.t == '350T' || mediaType.t == '400T' || mediaType.t == 'preview')) {
                thumbObj = extractMediaImage(media, mediaType);
            }

            // Extract image
            if (mediaType.t == 'fullview') {
                const extractedImage = extractMediaImage(media, mediaType);
                if (extractedImage) {
                    images.push(extractedImage);
                }
            }

            // Extract PDF
            if (mediaType.t == 'pdf') {
                const extractedPdf = extractMediaPdf(media, mediaType);
                if (extractedPdf) {
                    images.push(extractedPdf);
                }
            }

            // Extract video
            if (mediaType.t == 'video') {
                const extractedVideo = extractMediaVideo(media, mediaType);
                if (extractedVideo) {
                    videos.push(extractedVideo);
                }
            }
        }

        // Get thumb url
        const thumbUrl = thumbObj.url || images[0]?.url || '';

        // Add links to response.
        const links = [];

        for (const video of videos) {
            links.push({
                url: video.url,
                quality: video.quality,
                type: 'video',
            });
        }

        for (const image of images) {
            links.push({
                url: image.url,
                quality: image.quality,
                type: 'image',
            });
        }

        if (links.length) {
            response.content.push({
                title: title,
                thumb: thumbUrl,
                links: links,
            });
        }
    }

    function extractMediaImage(media, mediaType) {
        let url = '';
        let quality = '';

        // Add base URI
        if (typeof media.baseUri === 'undefined') {
            response.err.push('Property media.baseUri is missing, API changed.');
            return false;
        }

        url = media.baseUri;

        // Add URI part
        if (mediaType.c) {
            url += mediaType.c;
        }

        // Add token
        if (media.token && media.token[0]) {
            url += '?token=' + media.token[0];
        }

        // Replace pretty name
        if (media.prettyName) {
            url = url.replace('<prettyName>', media.prettyName);
        }

        // Extract quality
        if (mediaType.w && mediaType.h) {
            quality = mediaType.w + 'x' + mediaType.h;
        }

        return {
            url: url,
            quality: quality,
        };
    }

    function extractMediaPdf(media, mediaType) {
        let quality = '';

        if (typeof mediaType.s === 'undefined') {
            response.err.push('Property mediaType.s is missing, API changed.');
            return false;
        }

        return {
            url: mediaType.s,
            quality: quality,
        };
    }

    function extractMediaVideo(media, mediaType) {
        let url = '';
        let quality = '';

        // Add base URL
        if (typeof mediaType.b === 'undefined') {
            response.err.push('Property media.types[i].b is missing, API changed.');
            return false;
        }

        url += mediaType.b;

        // Videos do not work with token.

        // Replace pretty name
        if (media.prettyName) {
            url = url.replace('<prettyName>', media.prettyName);
        }

        // Extract quality
        if (mediaType.h) {
            quality = mediaType.h + 'p';
        }

        return {
            url: url,
            quality: quality,
        };
    }

    function extractDeviationIds(html) {
        let deviationIds = {
            id: {},
            length: 0,
        };

        // Extract deviation ids from supported items
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const LLItemElements = doc.querySelectorAll('div[data-testid="content_row"] > div > div');
        for (const LLItemElement of LLItemElements) {
            // Determine what content type thumb represents.
            const LLContentType = getContentType(LLItemElement);

            if (!LLContentType) {
                response.err.push('Unsupported content type.');
                continue;
            }

            if (LLContentType == 'literature') {
                continue;
            }

            if (LLContentType == 'locked') {
                continue;
            }

            // Extract item href
            const LLItemHref = LLItemElement.querySelector('a').getAttribute('href');
            if (!LLItemHref) {
                response.err.push('Cannot extract thumb href.');
                continue;
            }

            // Extract deviation id from href
            let deviationId = LLItemHref.match(/-(\d+)(\?.*)?$/);
            if (!deviationId || !deviationId[1]) {
                response.err.push('Cannot extract deviation id.');
                continue;
            }

            deviationIds.id[deviationId[1]] = {
                url: LLItemHref,
                type: LLContentType,
            };

            deviationIds.length++;
        }

        if (!deviationIds.length) {
            response.err.push('Empty gallery or cannot extract deviation IDs.');
        }

        return deviationIds;
    }

    function extractInitialJsonFromPageHtml(html) {
        // Extract __INITIAL_STATE__ json string
        const initialStateJsonString = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\(("[^\r\n]+")\);/);
        if (!initialStateJsonString || !initialStateJsonString[1]) {
            response.err.push('Cannot extract initial state.');
            return false;
        }

        // Parse __INITIAL_STATE__ json string
        const initialStateJson = JSON.parse(JSON.parse(initialStateJsonString[1].replaceAll("\\'", "'").trim()));
        if (!initialStateJson) {
            response.err.push('Cannot parse initial state.');
            return false;
        }

        // Check initialStateJson
        if (typeof initialStateJson['@@entities'] === 'undefined') {
            response.err.push('Property @@entities is missing, API changed: ' + LLThumbHref);
            return false;
        }

        if (typeof initialStateJson['@@entities'].deviation === 'undefined') {
            response.err.push('Property @@entities.deviation is missing, API changed.');
            return false;
        }

        if (typeof initialStateJson['@@entities'].deviationExtended === 'undefined') {
            response.err.push('Property @@entities.deviationExtended is missing, API changed.');
        }

        return initialStateJson;
    }

    // Determine if it's gallery or art URL
    const urlType = getUrlType(window.location.href);
    if (!urlType) {
        return response;
    }

    if (urlType == 'art') {
        const currentPageHtml =
            new XMLSerializer().serializeToString(document.doctype) +
            document.getElementsByTagName('html')[0].outerHTML;

        const initialStateJson = extractInitialJsonFromPageHtml(currentPageHtml);
        if (!initialStateJson) {
            return response;
        }

        extractDeviations(initialStateJson, window.location.href);

        return response;
    }

    if (urlType == 'gallery') {
        const currentPageHtml = (await fetchPageHtml(window.location.href)) || '';
        if (!currentPageHtml) {
            return response;
        }

        const initialStateJson = extractInitialJsonFromPageHtml(currentPageHtml);
        if (!initialStateJson) {
            return response;
        }

        const deviationIds = extractDeviationIds(currentPageHtml);
        if (!deviationIds.length) {
            return response;
        }

        await extractDeviationsByIds(initialStateJson, deviationIds, window.location.href);

        return response;
    }

    return response;
}

//     console.log(await SB_go());
// })();
