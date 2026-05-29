async function SB_go() {
    let LLAddedUrls = {};
    let LLData = {
        'err': [],
        'content': []
    };

    async function LLLoadLinks(url, qs, mime, width, height) {
        let links = [];

        if (mime != 'application/vnd.apple.mpegurl') {
            return [{
                'url': url + qs,
                'mime': mime,
                'width': width,
                'height': height,
            }]
        }

        let LLFetchRes = await fetch(url + qs, {
            'method': 'GET'
        });

        if (!LLFetchRes) {
            LLData.err.push('Fetch error: Can\'t load M3U8 URL.');
            return;
        }

        LLFetchRes = await LLFetchRes.text();

        const LLStreams = LLFetchRes.matchAll(/RESOLUTION=(\d+)x(\d+).+?(media-\d+\/stream\.m3u8)/sg);
        if (!LLStreams) {
            LLData.err.push('Extraction error: Can\'t extract M3U8 streams.');
            return;
        }

        for (const LLStream of LLStreams) {
            links.push({
                'url': url.replace(/\d+\.m3u8/, LLStream[3]) + qs,
                'mime': mime,
                'width': width,
                'height': height,
            });
        }

        return links;
    }

    async function LLExtractVariants(variants, contentId, index) {
        for (const variant of variants) {
            for (const location of variant.locations) {
                const qs = location.metadata ? '?' + new URLSearchParams(location.metadata).toString() : '';

                // Add thumb
                if (!LLData.content[index].thumb) {
                    if (variant.mimetype.match(/^image\//)) {
                        LLData.content[index].thumb = location.location + qs;
                    }
                }

                // Return array with link objects
                const links = await LLLoadLinks(location.location, qs, variant.mimetype, variant.width, variant.height);

                for (const link of links) {
                    // Prevent duplicate links
                    if (LLAddedUrls[link.url]) {
                        continue;
                    }
                    LLAddedUrls[link.url] = true;

                    // Add link
                    LLData.content[index].links.push({
                        'width': link.width,
                        'height': link.height,
                        'mime': link.mime,
                        'url': link.url
                    });
                }
            }
        }
    }

    const LLPostId = window.location.href.match(/\/post\/(\d+)/);
    if (!LLPostId || !LLPostId[1]) {
        LLData.err.push('Extraction error: Can\'t extract post id.');
        return LLData;
    }

    let LLToken = document.cookie.match(/f-s-c=([^;]+)/);
    if (LLToken && LLToken[1]) {
        LLToken = LLToken[1];
    } else {
        const LLSession = JSON.parse(localStorage.getItem('session_active_session'));
        LLToken = LLSession && LLSession.token ? LLSession.token : '';

    }
    if (!LLToken) {
        LLData.err.push('Extraction error: Can\'t extract token.');
        return LLData;
    }

    const LLFanslyPublicApiUrl = 'https://apiv3.fansly.com/api/v1/post?ids=' + LLPostId[1] + '&ngsw-bypass=true';
    let LLFetchRes = await fetch(LLFanslyPublicApiUrl, {
        'method': 'GET',
        'headers': {
            'authorization': LLToken
        }
    });

    if (!LLFetchRes) {
        LLData.err.push('Fetch error: Can\'t load public API URL.');
        return LLData;
    }

    LLFetchRes = await LLFetchRes.json();

    if (!LLFetchRes || !LLFetchRes.success) {
        LLData.err.push('Fetch error: Invalid response.');
        return LLData;
    }

    if (LLFetchRes.response === undefined) {
        LLData.err.push('Extraction error: \'response\' key is missing.');
        return LLData;
    }

    if (LLFetchRes.response.posts === undefined || !Array.isArray(LLFetchRes.response.posts)) {
        LLData.err.push('Extraction error: \'response.posts\' key is missing or not an array.');
        return LLData;
    }

    if (LLFetchRes.response.accountMedia === undefined || !Array.isArray(LLFetchRes.response.accountMedia)) {
        LLData.err.push('Extraction error: \'response.accountMedia\' key is missing or not an array.');
        return LLData;
    }

    if (LLFetchRes.response.accountMediaBundles === undefined || !Array.isArray(LLFetchRes.response.accountMediaBundles)) {
        LLData.err.push('Extraction error: \'response.accountMediaBundles\' key is missing or not an array.');
        return LLData;
    }

    if (LLFetchRes.response.aggregatedPosts === undefined || !Array.isArray(LLFetchRes.response.aggregatedPosts)) {
        LLData.err.push('Extraction error: \'response.aggregatedPosts\' key is missing or not an array.');
        return LLData;
    }

    // Collect all media IDs to load and extract
    const LLMediaToLoad = new Map();
    const LLMediaToExtract = new Map();
    for (const postIndex in LLFetchRes.response.posts) {
        const LLPost = LLFetchRes.response.posts[postIndex];

        if (LLPost.content === undefined) {
            LLData.err.push('Extraction error: \'response.posts[*].content\' key is missing.');
            continue;
        }

        if (LLPost.attachments === undefined) {
            LLData.err.push('Extraction error: \'response.posts[*].attachments\' key is missing.');
            continue;
        }

        for (const LLAttachment of LLPost.attachments) {
            if (!LLAttachment.contentId) {
                LLData.err.push('Extraction error: \'response.posts[*].attachments[*].contentId\' key is empty or missing.');
                continue;
            }

            // Collect media IDs from bundles
            for (const LLAccountMediaBundle of LLFetchRes.response.accountMediaBundles) {
                if (!LLAccountMediaBundle.id) {
                    LLData.err.push('Extraction error: \'response.accountMediaBundles[*].id\' key is empty or missing.');
                    continue;
                }

                if (LLAccountMediaBundle.accountMediaIds === undefined) {
                    LLData.err.push('Extraction error: \'response.accountMediaBundles[*].accountMediaIds\' key is missing.');
                    continue;
                }

                if (LLAccountMediaBundle.id == LLAttachment.contentId) {
                    for (const mediaIdIndex in LLAccountMediaBundle.accountMediaIds) {
                        let LLMedia = LLMediaToExtract.get(postIndex);
                        LLMedia ? LLMedia.push(LLAccountMediaBundle.accountMediaIds[mediaIdIndex]) : LLMedia = [LLAccountMediaBundle.accountMediaIds[mediaIdIndex]];
                        LLMediaToExtract.set(postIndex, LLMedia);

                        if (mediaIdIndex > 4) {
                            let LLMedia = LLMediaToLoad.get(postIndex);
                            LLMedia ? LLMedia.push(LLAccountMediaBundle.accountMediaIds[mediaIdIndex]) : LLMedia = [LLAccountMediaBundle.accountMediaIds[mediaIdIndex]];
                            LLMediaToLoad.set(postIndex, LLMedia);
                        }
                    }
                }
            }

            // Collect media IDs from media
            for (const LLAccountMedia of LLFetchRes.response.accountMedia) {
                if (!LLAccountMedia.id) {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].id\' key is empty or missing.');
                    continue;
                }

                if (LLAccountMedia.id == LLAttachment.contentId) {
                    let LLMedia = LLMediaToExtract.get(postIndex);
                    LLMedia ? LLMedia.push(LLAccountMedia.id) : LLMedia = [LLAccountMedia.id];
                    LLMediaToExtract.set(postIndex, LLMedia);
                }
            }
        }

        // Collect media IDs from aggregated posts
        for (const LLAggregatedPost of LLFetchRes.response.aggregatedPosts) {
            if (!LLAggregatedPost.accountId) {
                LLData.err.push('Extraction error: \'response.aggregatedPosts[*].accountId\' key is empty or missing.');
                continue;
            }

            for (const LLAccountMedia of LLFetchRes.response.accountMedia) {
                if (!LLAccountMedia.id) {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].id\' key is empty or missing.');
                    continue;
                }

                if (!LLAccountMedia.accountId) {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].accountId\' key is empty or missing.');
                    continue;
                }

                if (LLAggregatedPost.accountId === LLAccountMedia.accountId) {
                    let LLMedia = LLMediaToExtract.get(postIndex);
                    LLMedia ? LLMedia.push(LLAccountMedia.id) : LLMedia = [LLAccountMedia.id];
                    LLMediaToExtract.set(postIndex, LLMedia);
                }
            }
        }
    }

    // Load media
    if (LLMediaToLoad.size) {
        let LLMediaLoadErr = false;
        const LLFanslyPublicApiUrl = 'https://apiv3.fansly.com/api/v1/account/media?ids=' + Array.from(LLMediaToLoad, ([postIndex, mediaIds]) => (mediaIds)).join(',') + '&ngsw-bypass=true';
        let LLFetchResAccountMedia = await fetch(LLFanslyPublicApiUrl, {
            'method': 'GET',
            'headers': {
                'authorization': LLToken
            }
        });

        if (!LLFetchResAccountMedia) {
            LLData.err.push('Fetch error: Can\'t load public API URL.');
            LLMediaLoadErr = true;
        }

        if (!LLMediaLoadErr) {
            LLFetchResAccountMedia = await LLFetchResAccountMedia.json();
        }

        if (!LLMediaLoadErr && (!LLFetchResAccountMedia || !LLFetchResAccountMedia.success)) {
            LLData.err.push('Fetch error: Invalid response.');
            LLMediaLoadErr = true;
        }

        if (!LLMediaLoadErr && LLFetchResAccountMedia.response === undefined) {
            LLData.err.push('Extraction error: \'response\' key is missing.');
            LLMediaLoadErr = true;
        }

        if (!LLMediaLoadErr) {
            for (const LLAccountMedia of LLFetchResAccountMedia.response) {
                LLFetchRes.response.accountMedia.push(LLAccountMedia);
            }
        }
    }

    // Extract media
    let index = 0;
    for (const [postIndex, mediaIds] of LLMediaToExtract) {
        for (const mediaId of mediaIds) {
            for (const LLAccountMedia of LLFetchRes.response.accountMedia) {
                if (!LLAccountMedia.id) {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].id\' key is empty or missing.');
                    return LLData;
                }

                if (LLAccountMedia.id != mediaId) {
                    continue;
                }

                // Init final url
                if (!LLData.content[index]) {
                    LLData.content[index] = {
                        'title': LLFetchRes.response.posts[postIndex]?.content || LLFetchRes.response.aggregatedPosts[postIndex]?.content || '',
                        'thumb': '',
                        'links': [],
                    };
                }

                if (LLAccountMedia.media) {
                    await LLExtractVariants([LLAccountMedia.media], LLAccountMedia.id, index);

                    if (LLAccountMedia.media.variants) {
                        await LLExtractVariants(LLAccountMedia.media.variants, LLAccountMedia.id, index);
                    } else {
                        LLData.err.push('Extraction error: \'response.accountMedia[*].media.variants\' key is empty or missing.');
                    }

                } else {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].media\' key is empty or missing.');
                }

                if (LLAccountMedia.preview) {
                    await LLExtractVariants([LLAccountMedia.preview], LLAccountMedia.id, index);

                    if (LLAccountMedia.preview.variants) {
                        await LLExtractVariants(LLAccountMedia.preview.variants, LLAccountMedia.id, index);
                    } else {
                        LLData.err.push('Extraction error: \'response.accountMedia[*].preview.variants\' key is empty or missing.');
                    }

                } else {
                    LLData.err.push('Extraction error: \'response.accountMedia[*].preview\' key is empty or missing.');
                }

                index++;
            }
        }
    }

    return LLData;
}