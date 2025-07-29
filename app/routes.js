const express = require('express');
const request = require('request');
const router = express.Router();
const config = require('../app/config');

// URL Validation Functions
/** 
 * Validates if the provided string is a valid URL.
 * It checks if the string is non-empty, is a string, and can be parsed as a URL.
 * It also ensures that the URL uses either the 'http' or 'https' protocol.
 * @param {string} str - The string to validate as a URL.
 * @returns {boolean} - Returns true if the string is a valid URL, false otherwise.
 * @throws {Error} - Throws an error if the string is not a valid URL.
 */
function isValidURL(str) {
    try {
        const url = new URL(str);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

/**
 * Checks if the provided URL is a local URL.
 * It considers URLs with hostnames 'localhost', '127.0.1', '::1', or 'nhs-app-111-prototype' as local.
 * @param {string} url - The URL to check.
 * @returns {boolean} - Returns true if the URL is local, false otherwise.
 * @throws {Error} - Throws an error if the URL is invalid.
 */
function isLocalURL(url) {
    try {
        const { hostname } = new URL(url);
        return config.frame.localURLs.includes(hostname);
    } catch {
        return false;
    }
}

// Route Handlers
/**
 * Route to render the page within the frame.
 * It checks if the URL is valid and local, then renders the frame view.
 * If the URL is not valid, it returns a 400 status with an error message. 
 * If the URL is local, it will be loaded directly; otherwise, it will be proxied through the server.
 */
router.all('/proxy', (req, res) => {
    const url = req.query.url;

    if (!url) return res.status(400).send('Missing URL');
    if (!isValidURL(url)) return res.status(400).send('Invalid URL');

    const parsedUrl = new URL(url);

    const headers = {
        ...req.headers,
        'User-Agent': config.frame.userAgent,
        host: parsedUrl.host
    };

    delete headers['content-length'];

    const options = {
        url,
        method: req.method,
        headers,
        followRedirect: true,
        encoding: null // important for binary safety
    };

    const chunks = [];
    const proxyRequest = request(options);

    proxyRequest.on('response', proxyRes => {
        // Remove unwanted headers
        for (const header of config.frame.proxyHeaders) {
            delete proxyRes.headers[header];
        }

        const contentType = proxyRes.headers['content-type'] || '';

        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
            const buffer = Buffer.concat(chunks);

            // Handle HTTP redirect after form POST (e.g. 302, 303, 307, 308)
            if (
                [301, 302, 303, 307, 308].includes(proxyRes.statusCode) &&
                proxyRes.headers['location']
            ) {
                let location = proxyRes.headers['location'];
                try {
                    // If relative, resolve against the original URL
                    location = new URL(location, parsedUrl).href;
                } catch {
                    // fallback: leave as is
                }
                // Only redirect if status code is valid and location is a valid URL
                if (
                    typeof proxyRes.statusCode === 'number' &&
                    proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 &&
                    typeof location === 'string' && location
                ) {
                    return res.redirect(proxyRes.statusCode, `/proxy?url=${encodeURIComponent(location)}`);
                } else {
                    // fallback: just send the body as-is
                    res.set('content-type', contentType);
                    return res.status(200).send(buffer.toString('utf8'));
                }
            }

            if (contentType.includes('text/html')) {
                let body = buffer.toString('utf8');
                const origin = parsedUrl.origin;

                console.log(origin, 'origin');

                // Helper to rewrite URLs for proxying
                function rewriteUrl(attr, value) {
                    try {
                        // Ignore anchors, javascript:, mailto:, tel:, etc.
                        if (
                            !value ||
                            typeof value !== 'string' ||
                            value.startsWith('#') ||
                            value.startsWith('javascript:') ||
                            value.startsWith('mailto:') ||
                            value.startsWith('tel:')
                        ) {
                            return value;
                        }
                        // If already proxied, don't double-proxy
                        if (value.startsWith('/proxy?url=')) {
                            return value;
                        }
                        // Absolute URL
                        if (/^https?:\/\//i.test(value)) {
                            return `/proxy?url=${encodeURIComponent(value)}`;
                        }
                        // Protocol-relative URL (e.g. //example.com)
                        if (/^\/\//.test(value)) {
                            return `/proxy?url=${encodeURIComponent(parsedUrl.protocol + value)}`;
                        }
                        // Root-relative or relative URL
                        // Use parsedUrl.href (full URL including path) as base
                        const fullUrl = new URL(value, parsedUrl.href).href;
                        return `/proxy?url=${encodeURIComponent(fullUrl)}`;
                    } catch {
                        return value;
                    }
                }

                // Rewrite action
                body = body.replace(/action=["']([^"']+)["']/gi, (match, url) => {
                    let proxiedUrl;
                    try {
                        proxiedUrl = new URL(url, parsedUrl.href).href;
                    } catch {
                        proxiedUrl = url;
                    }
                    // Only rewrite if the URL is valid
                    if (!proxiedUrl || typeof proxiedUrl !== 'string') return match;
                    return `action="/proxy?url=${encodeURIComponent(proxiedUrl)}"`;
                });

                // Rewrite href only on anchor tags
                body = body.replace(/<a([^>]+)href=["']([^"']+)["']/gi, (match, pre, url) => {
                    return `<a${pre}href="${rewriteUrl('href', url)}"`;
                });

                // Rewrite src
                body = body.replace(/src=["']([^"']+)["']/gi, (match, url) => {
                    return `src="${rewriteUrl('src', url)}"`;
                });

                res.set('content-type', contentType);
                res.status(proxyRes.statusCode).send(body);

            } else {
                // For binary or non-HTML content
                res.set(proxyRes.headers);
                res.status(proxyRes.statusCode).send(buffer);
            }

        });
    });

    proxyRequest.on('error', err => {
        console.error(err);
        res.status(500).send('Proxy error');
    });

    // Forward the request body
    req.pipe(proxyRequest);
});


/**
 * Route to render the frame launcher page.
 * This page allows users to input a URL to be loaded in the frame.
 * It validates the URL and redirects to the frame view with the provided URL.
 */
router.all('/frame', (req, res) => {

    // Accept from querystring as `URL` or from form body as `frameURL`
    let frameURL = req.query.URL || req.body.frameURL;
    const requestPort = req.socket.localPort;
    const serverPort = process.env.PORT;
    let showOverlay = requestPort !== serverPort;

    // if no URL is provided, use the default URL
    if (!frameURL || typeof frameURL !== 'string' || frameURL.trim() === '') {
        frameURL = config.frame.defaultURL || '/pages/home-p9';
        showOverlay = false;
    }

    // Handle root-relative paths adding the server host
    if (typeof frameURL === 'string' && frameURL.startsWith('/')) {
        frameURL = `http://${req.headers.host}${frameURL}`;
        showOverlay = false;
    }

    // Ensure the URL starts with http:// or https://
    // If it doesn't, prepend http://
    // This is necessary for the URL to be valid and to avoid issues with the iframe
    // Note: This does not validate the URL, it just ensures it has a protocol
    // This is important for the iframe to load correctly
    // If the URL is a local URL, it will not be handled by the proxy
    // If the URL is not a local URL, it will be proxied through the server
    if (
        typeof frameURL === 'string' &&
        !frameURL.startsWith('http://') &&
        !frameURL.startsWith('https://') &&
        !frameURL.startsWith('/')
    ) {
        frameURL = `http://${frameURL}`;
    }

    // Validation and rendering
    if (!isValidURL(frameURL)) {
        return res.status(400).send('A valid URL is required');
    }

    res.render('frame', {
        frameURL,
        localURL: isLocalURL(frameURL),
        showOverlay
    });
});

module.exports = router;