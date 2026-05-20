### Issue #1
"As your extension is compatible with Firefox 139 and earlier a custom data collection collection and transmission consent screen is required in order to be compliant.”

Solution: The extension is no longer compatible with Firefox 139 and earlier; it is now a Manifest V3 (MV3) extension.

### Issue #2
“Please remove all remote hosts from the CSP ‘script-src’ declaration, if any.”

Solution: There were and are no script-src directives linking to external sources.

### Issue #3
"Sources, specifically Third party library information missing: Your add-on includes a third-party library.”

Solution: We have added libs/links.md, which details the exact origins and versions of the third-party libraries used.

### Issue #4:
"The declared data collection permissions do not match the data collected and transmitted by the add-on. Personal data (unique identifier).”

Solution: This is a false positive. We do not collect, store, or transmit any personal data. The referenced UUIDs (universally unique identifiers) are used solely to manage HTTP headers and tabs, so the personallyIdentifyingInfo permission does not apply to our use case. We believe the websiteContent permission is the best fit for our extension.

### Issue #5
“Security, specifically Remote code execution”.

Response: fetcher.js executes code using eval(), but this code originates exclusively from the trusted sources https://www.locoloader.com/* and https://www.locoloader.test/*. This code allows Locoloader users to scrape the data they request. We decided to separate this code from the extension because it is subject to frequent updates. This approach allows us to provide a better user experience (UX) by deploying quick fixes when a scraper breaks, without forcing frequent extension updates. It also prevents us from flooding you with weekly extension updates just because we changed a CSS selector in our scraping script, for example. Please reconsider this point and let us know whether we need to include our scraping scripts directly within the extension or if we can continue to run them from these trusted sources before we re-submit our extension to the store for approval.