async function SB_go() {
    function LLClick(selector) {
        const el = document.querySelector(selector);
        if (!el) {
            LLData.err.push('DOM error: Click element ' + selector + ' not found.');
            return false;
        } else {
            el.click();
            return true;
        }
    }

    async function LLElement(selector, nth = 0, reloadInMs = 250, maxAttempts = 8) {
        const el = document.querySelectorAll(selector);
        maxAttempts--;

        if (!el[nth]) {
            if (maxAttempts < 1) {
                LLData.err.push('DOM error: Element' + selector + '[' + nth + '] not found.');
                return false;
            }

            await LLWait(reloadInMs);
            return await LLElement(selector, nth, reloadInMs, maxAttempts);

        } else {
            return el[nth];
        }
    }

    async function LLElements(selector, el = null, reloadInMs = 250, maxAttempts = 8) {
        let els = [];
        if (el == null) {
            els = document.querySelectorAll(selector);
        } else {
            els = el.querySelectorAll(selector);
        }

        maxAttempts--;
        if (!els.length) {
            if (maxAttempts < 1) {
                LLData.err.push('DOM error: Element ' + selector + ' not found.');
                return false;
            }

            await LLWait(reloadInMs);
            return await LLElements(selector, el, reloadInMs, maxAttempts);

        } else {
            return els;
        }
    }

    function LLWait(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    async function LLWaitFor(getElement, errMsg, reloadInMs = 250, maxAttempts = 8) {
        maxAttempts--;
        const el = getElement();
        if (!el) {
            if (maxAttempts < 1) {
                LLData.err.push('DOM error: ' + errMsg);
                return false;
            }

            await LLWait(reloadInMs);
            return await LLWaitFor(getElement, errMsg, reloadInMs, maxAttempts);

        } else {
            return el;
        }
    }

    function LLGetLinkQuality(link) {
        const quality = link.match(/_(\d+)p\./);
        return quality && quality[1] ? quality[1] : 0;
    }

    async function LLLoadInitializedDOM(regExp, reloadInMs = 100, maxAttempts = 10) {
        const LLPageDom = new XMLSerializer().serializeToString(document.doctype) + document.getElementsByTagName('html')[0].outerHTML;
        if (maxAttempts < 1) return LLPageDom;
        if (LLPageDom.match(regExp)) return LLPageDom;
        maxAttempts--;
        await LLWait(reloadInMs);
        return await LLLoadInitializedDOM(regExp, reloadInMs, maxAttempts);
    }

    function LLDetectExtractors(LLPageDom) {
        let extractors = {};

        const LLPlayerUrl = LLPageDom.match(/https?:\/\/player\.zype[^"']+/);
        if (LLPlayerUrl) {
            extractors[2] = LLPlayerUrl[0];
        }

        if (LLPageDom.match(/vjs-big-play-button/)) {
            extractors[1] = true;
        }

        if (LLPageDom.match(/img-responsive/)) {
            extractors[3] = true;
        }

        if (LLPageDom.match(/swiper-wrapper/)) {
            extractors[4] = true;
        }

        if (LLPageDom.match(/oftv_container/)) {
            extractors[5] = true;
        }

        if (!Object.keys(extractors).length) {
            LLData.err.push('Extraction error: Can\'t determine the extractor.');
            return LLData;
        }

        return extractors;
    }

    function LLGetImgLink() {
        try {
            const LLTmpWindow = window.wrappedJSObject ? window.wrappedJSObject : window;
            return LLTmpWindow.pswp.element.innerHTML.match(/src="([^"]+)/)[1].replaceAll('&amp;', '&')
        } catch {
            return false;
        }
    }

    function LLGetImgLinkNext() {
        try {
            const LLTmpWindow = window.wrappedJSObject ? window.wrappedJSObject : window;
            return [...(LLTmpWindow.pswp.element.innerHTML.matchAll(/src="([^"]+)/g))][1][1].replaceAll('&amp;', '&');
        } catch {
            return false;
        }
    }

    async function LLLoadAndExtractStream(url, links = [], debug = '') {
        links.push({
            'url': url,
            'type': 'playlist',
            'width': 0,
            'height': 0,
        });

        return;
    }

    // Data we return
    var LLData = {
        'err': [],
        'content': [],
    };

    const LLPageDom = await LLLoadInitializedDOM(/vjs-big-play-button|player\.zype\.com|img-responsive|swiper-wrapper|oftv_container/);

    const extractors = LLDetectExtractors(LLPageDom);
    if (!Object.keys(extractors).length) {
        LLData.err.push('Extraction error: Can\'t determine the extractor.');
        return LLData;
    }

    const el = await LLElement('div[class~="g-truncated-text"]');
    const title = el && el.textContent ? el.textContent : '';

    async function LLExtract(extractors, omit = {}, activeVideoSlide = 0) {
        if (!omit[1] && extractors[1]) {
            if (!LLClick('[class="vjs-big-play-button has-tooltip"]')) return;
            await LLWait(250);

            const el = await LLElement('video', activeVideoSlide);
            if (!el) {
                LLData.err.push('Extraction error: Can\'t extract video.');
                return;
            }

            const els = await LLElements('source', el);
            if (!els || !els.length) return;

            const thumb = el.poster || '';
            if (!thumb) {
                LLData.err.push('Extraction error: Can\'t extract poster.');
            }

            const LLLinks = [];
            for (const el of els) {
                if (!el.src) {
                    LLData.err.push('Extraction error: \'src\' video attribute is empty or missing.');
                    return;
                }

                if (!el.getAttribute('label')) {
                    LLData.err.push('Extraction error: \'label\' video attribute is empty or missing.');
                }

                LLLinks.push({
                    'url': el.src,
                    'type': 'video',
                    'width': 0,
                    'height': el.getAttribute('label') ? el.getAttribute('label') : LLGetLinkQuality(el.src)
                });
            }

            LLData.content.push({
                'title': title,
                'thumb': thumb,
                'links': LLLinks,
            });
        }

        if (!omit[2] && extractors[2]) {
            let LLFetchRes = await fetch(extractors[2].replaceAll('&amp;', '&'), {
                'referrer': window.location.href,
                'method': 'GET'
            });

            if (!LLFetchRes) {
                LLData.err.push('Fetch error: Can\'t load URL.');
                return;
            }

            LLFetchRes = await LLFetchRes.text();

            let LLThumb = LLFetchRes.match(/theoplayer.poster\s?=\s?['"]([^'"]+)/);
            if (LLThumb && LLThumb[1]) {
                LLThumb = LLThumb[1];
            } else {
                LLData.err.push('Extraction error: Can\'t extract thumb.');
                LLThumb = '';
            }

            const LLVideoSources = LLFetchRes.match(/sources:\s(\[[^\]]+\])/s);
            if (!LLVideoSources || !LLVideoSources[1]) {
                LLData.err.push('Extraction error: Can\'t extract video sources.');
                return;
            }

            const LLLinksArr = LLVideoSources[1].matchAll(/src\s?:\s?.+?['"]([^'"]+)/sg);
            if (!LLLinksArr) {
                LLData.err.push('Extraction error: Can\'t extract links from video sources.');
                return;
            }

            LLData.content[0] = {
                'title': title,
                'thumb': LLThumb,
                'links': [],
            }

            const LLLinks = [];

            for (const LLLink of LLLinksArr) {
                if (LLLink[1].match(/\.m3u8\?/)) {
                    // M3U8
                    await LLLoadAndExtractStream(LLLink[1], LLLinks);

                } else if (LLLink[1].match(/\.mp4\?/)) {
                    // MP4 or other
                    LLLinks.push({
                        'url': LLLink[1],
                        'type': 'video',
                        'width': 0,
                        'height': LLGetLinkQuality(LLLink[1])
                    });
                }
            }

            LLData.content.push({
                'title': title,
                'thumb': LLThumb,
                'links': LLLinks,
            });
        }

        if (!omit[3] && extractors[3]) {
            const elArr = await LLElements('img[class~="img-responsive"]');
            if (!elArr || !elArr.length) return;

            for (const el of elArr) {
                if (!el.src) {
                    LLData.err.push('Extraction error: \'src\' image attribute is empty or missing.');
                    return;
                }

                el.click();

                const link = await LLWaitFor(LLGetImgLink, 'Link not found.');

                if (!link) {
                    return;
                }

                document.querySelector('.pswp__button--close').click();

                const resolution = link.match(/\/(\d+)x(\d+)/);

                LLData.content.push({
                    'title': title,
                    'thumb': el.src,
                    'links': [{
                        'url': link,
                        'type': 'image',
                        'width': resolution[1] || 0,
                        'height': resolution[2] || 0,
                    }],
                });
            }
        }

        if (!omit[4] && extractors[4]) {
            let el = await LLElement('.swiper');
            el = el.wrappedJSObject ?? el;

            if (el.swiper) {
                let activeSlideElement = el.swiper.slides[0];
                let videoIndex = 0;

                // Extract first slide
                if (activeSlideElement.querySelector('div').classList.contains('m-video')) {
                    // Slide contains video
                    await LLWait(250);
                    const LLPageDom = await LLLoadInitializedDOM();
                    const extractors = LLDetectExtractors(LLPageDom);
                    await LLExtract(extractors, { 3: true, 4: true }, videoIndex ? 1 : 0);
                    videoIndex++;
                }

                if (activeSlideElement.querySelector('div').classList.contains('m-photo')) {
                    // Slide contains image
                    const img = activeSlideElement.querySelector('img');

                    img.click();

                    const link = await LLWaitFor(LLGetImgLink, 'Link not found.');

                    if (!link) {
                        return;
                    }

                    document.querySelector('.pswp__button--close').click();

                    const resolution = link.match(/\/(\d+)x(\d+)/);

                    LLData.content.push({
                        'title': title,
                        'thumb': img.currentSrc,
                        'links': [{
                            'url': link,
                            'type': 'image',
                            'width': resolution[1] || 0,
                            'height': resolution[2] || 0,
                        }],
                    });
                }

                // Extract next slides
                let nextSlide = el.swiper.slideNext();
                while (nextSlide) {
                    await LLWait(250);
                    activeSlideElement = el.swiper.slides[1];

                    if (activeSlideElement.querySelector('div').classList.contains('m-video')) {
                        // Slide contains video
                        const LLPageDom = await LLLoadInitializedDOM();
                        const extractors = LLDetectExtractors(LLPageDom);
                        await LLExtract(extractors, { 3: true, 4: true }, videoIndex ? 1 : 0);
                        videoIndex++;
                    }

                    if (activeSlideElement.querySelector('div').classList.contains('m-photo')) {
                        // Slide contains image
                        const img = activeSlideElement.querySelector('img');

                        img.click();

                        const link = await LLWaitFor(LLGetImgLinkNext, 'Next link not found.');

                        if (!link) {
                            return;
                        }

                        document.querySelector('.pswp__button--close').click();

                        const resolution = link.match(/\/(\d+)x(\d+)/);

                        LLData.content.push({
                            'title': title,
                            'thumb': img.currentSrc,
                            'links': [{
                                'url': link,
                                'type': 'image',
                                'width': resolution[1] || 0,
                                'height': resolution[2] || 0,
                            }],
                        });
                    }

                    nextSlide = el.swiper.slideNext();
                }
            }
        }

        if (!omit[5] && extractors[5]) {
            const iframe = await LLElement('[class~="oftv_container"] > iframe');
            if (!iframe) return;

            if (!iframe.src) {
                LLData.err.push('Extraction error: Can\'t extract video iframe source.');
                return;
            }

            let videoApiUrl = iframe.src.replace('/cdn.', '/api.');
            videoApiUrl = videoApiUrl.replace('tv/v/', 'tv/v0/videos/');
            videoApiUrl = videoApiUrl.replace(/\/embed\/?/, '');

            let LLFetchRes = await fetch(videoApiUrl, {
                'referrer': window.location.href,
                'method': 'GET'
            });

            if (!LLFetchRes) {
                LLData.err.push('Fetch error: Can\'t load URL.');
                return;
            }

            const videoApiResponse = JSON.parse(await LLFetchRes.text());

            if (!videoApiResponse) {
                LLData.err.push('Extraction error: Can\'t parse video API response.');
                return;
            }

            let LLThumb = '';
            if (!videoApiResponse.data || !videoApiResponse.data.video || !videoApiResponse.data.video.thumbnail) {
                LLData.err.push('Extraction error: Video API changed, thumbnail not found.');
            } else {
                LLThumb = videoApiResponse.data.video.thumbnail[480] || videoApiResponse.data.video.thumbnail[360];
            }

            let LLTitle = '';
            if (!videoApiResponse.data || !videoApiResponse.data.video || !videoApiResponse.data.video.title) {
                LLData.err.push('Extraction error: Video API changed, title not found.');
            } else {
                LLTitle = videoApiResponse.data.video.title;
            }

            if (!videoApiResponse.data || !videoApiResponse.data.video || !videoApiResponse.data.video.video_src) {
                LLData.err.push('Extraction error: Video API changed, source not found.');
                return;

            } else {
                const videoStream = videoApiResponse.data.video.video_src;
                const LLLinks = [];
                await LLLoadAndExtractStream(videoStream, LLLinks);

                LLData.content[0] = {
                    'title': LLTitle,
                    'thumb': LLThumb,
                    'links': LLLinks,
                }
            }
        }
    }

    await LLExtract(extractors, extractors[4] ? { 1: true, 2: true, 3: true, 5: true } : {});

    return LLData;
}