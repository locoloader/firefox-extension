async function SB_go() {
    let LLData = {
        'err': [],
        'content': []
    };

    const LLLastGalleryPageEl = document.querySelectorAll('a.rightKey');
    if (!LLLastGalleryPageEl.length) {
        LLData.err.push('single page gallery');
        return LLData;
    }

    const LLLastGalleryPageUrl = LLLastGalleryPageEl.length < 1 ? false : LLLastGalleryPageEl[1].getAttribute('href');
    if (!LLLastGalleryPageUrl) {
        LLData.err.push('Extraction error: Cannot extract last gallery page url.');
        return LLData;
    }

    let LLFetchRes = await fetch(LLLastGalleryPageUrl, {
        'method': 'GET',
    });

    if (!LLFetchRes) {
        LLData.err.push('Fetch error: Cannot load last gallery page.');
        return LLData;
    }

    const LLLastGalleryPageHtml = await LLFetchRes.text();

    const LLThumbLinks = LLLastGalleryPageHtml.matchAll(/\/pics\/\d+\/[\w-]+\/\d+/gs);
    if (!LLThumbLinks) {
        LLData.err.push('Extraction error: Cannot extract thumb hrefs.');
        return LLData;
    }

    for (const LLThumbLink of LLThumbLinks) {
        LLData.content.push(LLThumbLink[0]);
    }

    return LLData;
}