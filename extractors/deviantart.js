async function SB_go() {
    let LLData = {
        err: [],
        content: [],
        nextPage: '',
    };

    let extractedTitles = new Map();

    function LLGetContentType(el) {
        if (el.querySelector('span[aria-label="stack of images"]')) {
            const imgElement = el.querySelector('img');
            if (imgElement && imgElement.getAttribute('src').includes(',blur_')) {
                return 'locked';
            }

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
            if (imgElement.getAttribute('src').includes(',blur_')) {
                return 'locked';
            }

            return 'image';
        }

        if (el.querySelector('div').innerText == 'Literature') {
            return 'literature';
        }

        return '';
    }

    function LLGetUrlType(url) {
        if (url.match(/deviantart\.com\/[^\/]+\/art(\/|\?)?|deviantart\.com\/stash\//)) {
            return 'art';
        }

        if (url.match(/deviantart\.com\/[^\/]+\/(gallery|favourites)(\/|\?)?/)) {
            return 'gallery';
        }

        LLData.err.push('Cannot determine URL type.');
        return '';
    }

    async function LLFetchPageHtml(url) {
        console.log('Fetching:', url);

        const res = await fetch(url);

        if (!res.ok) {
            LLData.err.push('Cannot fetch url.');
            return '';
        }

        return await res.text();
    }

    function LLExtractDeviations(initialStateJson, pageUrl) {
        for (const deviationId in initialStateJson['@@entities'].deviation) {
            LLExtractDeviationById(initialStateJson, deviationId, pageUrl);
        }
    }

    async function LLExtractDeviationsByIds(initialStateJson, deviationIds, pageUrl) {
        for (const deviationId in deviationIds.id) {
            // If we extract deviations from gallery page, fetch initialStateJson from collection pages
            if (deviationIds.id[deviationId].type == 'collection') {
                const html = await LLFetchPageHtml(deviationIds.id[deviationId].url);
                if (!html) return;

                const collectionInitialStateJson = LLExtractInitialJsonFromPageHtml(html);
                if (collectionInitialStateJson) {
                    LLExtractDeviationById(collectionInitialStateJson, deviationId, pageUrl);
                }
            } else {
                LLExtractDeviationById(initialStateJson, deviationId, pageUrl);
            }
        }
    }

    function LLExtractDeviationById(initialStateJson, deviationId, pageUrl) {
        if (initialStateJson['@@entities'].deviation[deviationId]) {
            if (typeof initialStateJson['@@entities'].deviation[deviationId].media === 'undefined') {
                LLData.err.push('Property @@entities.deviation[' + deviationId + '].media is missing, API changed.');
                return;
            }

            // Extract title.
            let title = 'Untitled';
            if (typeof initialStateJson['@@entities'].deviation[deviationId].title === 'undefined') {
                LLData.err.push('Property @@entities.deviation[id].title is missing, API changed.');
            } else {
                title = initialStateJson['@@entities'].deviation[deviationId].title;
            }

            // Extract deviation media.
            LLExtractMedia(title, initialStateJson['@@entities'].deviation[deviationId].media, pageUrl);

            // Extract deviation extended media.
            if (initialStateJson['@@entities'].deviationExtended) {
                if (!initialStateJson['@@entities'].deviationExtended[deviationId]) {
                    LLData.err.push('Property @@entities.deviationExtended[' + deviationId + '] is missing.');
                    return;
                }

                if (typeof initialStateJson['@@entities'].deviationExtended[deviationId].additionalMedia === 'undefined') {
                    LLData.err.push('Property @@entities.deviationExtended[' + deviationId + '].additionalMedia is missing. Post does not include any additional media or API changed.');
                    return;
                }

                for (const additionalMedia of initialStateJson['@@entities'].deviationExtended[deviationId].additionalMedia) {
                    if (typeof additionalMedia.media === 'undefined') {
                        LLData.err.push('Property @@entities.deviationExtended[' + deviationId + '].additionalMedia[i].media is missing, API changed.');
                        return;
                    }

                    LLExtractMedia(title, additionalMedia.media, pageUrl);
                }
            }
        } else {
            LLData.err.push('Property @@entities.deviation[' + deviationId + '] is missing.');
        }
    }

    function LLExtractMedia(title, media, pageUrl) {
        if (typeof media.types === 'undefined') {
            LLData.err.push('Property media.types is missing, API changed.');
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
        let imageObj;
        let videoArr = [];

        for (const mediaType of media.types) {
            if (typeof mediaType.t === 'undefined') {
                LLData.err.push('Property media.types[i].t is missing, API changed.');
                continue;
            }

            // Extract thumb
            if (!thumbObj && (mediaType.t == '350T' || mediaType.t == '400T' || mediaType.t == 'preview')) {
                thumbObj = LLExtractMediaImage(media, mediaType);
                continue;
            }

            // Extract image
            if (mediaType.t == 'fullview') {
                imageObj = LLExtractMediaImage(media, mediaType);
                continue;
            }

            // Extract PDF
            if (mediaType.t == 'pdf') {
                imageObj = LLExtractMediaPdf(media, mediaType);
                continue;
            }

            // Extract video
            if (mediaType.t == 'video') {
                const extractedVideo = LLExtractMediaVideo(media, mediaType);

                if (extractedVideo) {
                    videoArr.push(extractedVideo);
                }

                continue;
            }
        }

        // Get thumb url
        let thumbUrl = '';
        if (thumbObj) {
            thumbUrl = thumbObj.url;
        } else if (imageObj) {
            thumbUrl = imageObj.url;
        }

        // Add image to response
        if (imageObj) {
            LLData.content.push({
                url: pageUrl,
                title: title,
                thumb: thumbUrl || '',
                links: [
                    {
                        url: imageObj.url,
                        quality: imageObj.quality,
                        type: 'image',
                    },
                ],
            });
        }

        // Add video to response
        let videoLinks = [];
        for (const videoObj of videoArr) {
            videoLinks.push({
                url: videoObj.url,
                quality: videoObj.quality,
                type: 'video',
            });
        }

        if (videoLinks.length > 0) {
            LLData.content.push({
                title: title,
                thumb: thumbUrl,
                links: videoLinks,
            });
        }
    }

    function LLExtractMediaImage(media, mediaType) {
        let url = '';
        let quality = '';

        // Add base URI
        if (typeof media.baseUri === 'undefined') {
            LLData.err.push('Property media.baseUri is missing, API changed.');
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

    function LLExtractMediaPdf(media, mediaType) {
        let quality = '';

        if (typeof mediaType.s === 'undefined') {
            LLData.err.push('Property mediaType.s is missing, API changed.');
            return false;
        }

        return {
            url: mediaType.s,
            quality: quality,
        };
    }

    function LLExtractMediaVideo(media, mediaType) {
        let url = '';
        let quality = '';

        // Add base URL
        if (typeof mediaType.b === 'undefined') {
            LLData.err.push('Property media.types[i].b is missing, API changed.');
            return false;
        }

        url += mediaType.b;

        // Add token
        if (media.token && media.token[0]) {
            url += '?token=' + media.token[0];
        }

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

    async function LLFetchAndExtractGalleryPage(url) {
        const html = await LLFetchPageHtml(url);
        if (!html) return;

        const deviationIds = LLExtractDeviationIds(html);
        if (!deviationIds.length) return;

        const initialStateJson = LLExtractInitialJsonFromPageHtml(html);
        if (!initialStateJson) return;

        await LLExtractDeviationsByIds(initialStateJson, deviationIds, url);
    }

    function LLExtractDeviationIds(html) {
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
            const LLContentType = LLGetContentType(LLItemElement);

            if (!LLContentType) {
                LLData.err.push('Unsupported content type.');
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
                LLData.err.push('Cannot extract thumb href.');
                continue;
            }

            // Extract deviation id from href
            let deviationId = LLItemHref.match(/-(\d+)(\?.*)?$/);
            if (!deviationId || !deviationId[1]) {
                LLData.err.push('Cannot extract deviation id.');
                continue;
            }

            deviationIds.id[deviationId[1]] = {
                url: LLItemHref,
                type: LLContentType,
            };

            deviationIds.length++;
        }

        if (!deviationIds.length) {
            LLData.err.push('Empty gallery or cannot extract deviation IDs.');
        }

        return deviationIds;
    }

    function LLExtractInitialJsonFromPageHtml(html) {
        // Extract __INITIAL_STATE__ json string
        const initialStateJsonString = html.match(/window\.__INITIAL_STATE__\s*=\s*JSON\.parse\(("[^\r\n]+")\);/);
        if (!initialStateJsonString || !initialStateJsonString[1]) {
            LLData.err.push('Cannot extract initial state.');
            return false;
        }

        // Parse __INITIAL_STATE__ json string
        const initialStateJson = JSON.parse(JSON.parse(initialStateJsonString[1].replaceAll("\\'", "'").trim()));
        if (!initialStateJson) {
            LLData.err.push('Cannot parse initial state.');
            return false;
        }

        // Check initialStateJson
        if (typeof initialStateJson['@@entities'] === 'undefined') {
            LLData.err.push('Property @@entities is missing, API changed: ' + LLThumbHref);
            return false;
        }

        if (typeof initialStateJson['@@entities'].deviation === 'undefined') {
            LLData.err.push('Property @@entities.deviation is missing, API changed.');
            return false;
        }

        if (typeof initialStateJson['@@entities'].deviationExtended === 'undefined') {
            LLData.err.push('Property @@entities.deviationExtended is missing, API changed.');
        }

        return initialStateJson;
    }

    // Determine if it's gallery or art URL
    const urlType = LLGetUrlType(window.location.href);
    if (!urlType) return LLData;

    if (urlType == 'art') {
        const currentPageHtml = new XMLSerializer().serializeToString(document.doctype) + document.getElementsByTagName('html')[0].outerHTML;
        const initialStateJson = LLExtractInitialJsonFromPageHtml(currentPageHtml);

        if (initialStateJson) LLExtractDeviations(initialStateJson, window.location.href);

        return LLData;
    }

    if (urlType == 'gallery') {
        // Check if the window.location.href contains a valid 'page' query string and use it as the current page.
        let currentPageQuery = undefined;
        const params = new URLSearchParams(window.location.search);
        if (params.has('page') && params.get('page').match(/^\d+$/)) {
            currentPageQuery = parseInt(params.get('page'));
        }

        // Get current page HTML
        const currentPageHtml = new XMLSerializer().serializeToString(document.doctype) + document.getElementsByTagName('html')[0].outerHTML;

        // Extract the number of the last page.
        let lastPage;
        const matches = currentPageHtml.matchAll(/totalPages\\\":(\d+)/g);
        if (matches) {
            const pageNumbers = Array.from(matches).map((match) => Number(match[1]));
            lastPage = Math.max(...pageNumbers);
        }

        // Fetch gallery URLs to extract up to 240 gallery items.
        const startPage = currentPageQuery ? currentPageQuery : 1;
        const endPage = lastPage ? Math.min(currentPageQuery ? currentPageQuery + 9 : 10, lastPage) : startPage;
        const urlObj = new URL(window.location.href);
        const urlWithoutQuery = urlObj.origin + urlObj.pathname;

        for (let i = startPage; i <= endPage; i++) {
            if (params.size) {
                params.set('page', i);
                await LLFetchAndExtractGalleryPage(urlWithoutQuery + '?' + params.toString());
            } else {
                await LLFetchAndExtractGalleryPage(urlWithoutQuery + '?page=' + i);
            }
        }

        // Add next page to result
        if (lastPage && endPage < lastPage) {
            let nextPage = '';
            if (params.size) {
                params.set('page', endPage + 1);
                nextPage = urlWithoutQuery + '?' + params.toString();
            } else {
                nextPage = urlWithoutQuery + '?page=' + (endPage + 1);
            }
            LLData.nextPage = nextPage;
        }

        return LLData;
    }

    return LLData;
}