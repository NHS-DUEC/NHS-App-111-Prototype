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
router.get('/proxy', (req, res) => {
    const url = req.query.url;
    
    // Validation
    if (!url) return res.status(400).send('Missing URL');
    if (!isValidURL(url)) return res.status(400).send('Invalid URL');

    // Proxy request setup
    const proxyRequest = request.get({
        url,
        headers: {
            'User-Agent': config.frame.userAgent
        }
    });

    // Handle proxy response
    proxyRequest.on('response', response => {
        // Clean headers
        for (const header of config.frame.proxyHeaders) {
            delete response.headers[header];
        }

        const contentType = response.headers['content-type'] || '';
        
        // Handle HTML content
        if (contentType.includes('text/html')) {
            let body = '';
            
            response.on('data', chunk => body += chunk);
            
            response.on('end', () => {
                // Rewrite root-relative URLs
                const baseProxy = `/proxy?url=${encodeURIComponent(new URL('/', url).origin)}`;
                body = body.replace(/(href|src|action)=["']\/(?!\/)/gi, `$1="${baseProxy}/`);
                
                res.set('content-type', contentType);
                res.send(body);
            });
        } else {
            // Pass through non-HTML content
            response.pipe(res);
        }
    });

    // Handle errors
    proxyRequest.on('error', err => {
        res.status(500).send('Proxy error');
    });
});

/**
 * Route to render the frame launcher page.
 * This page allows users to input a URL to be loaded in the frame.
 * It validates the URL and redirects to the frame view with the provided URL.
 */
router.all('/frame', (req, res) => {
    let { frameURL } = req.body;
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