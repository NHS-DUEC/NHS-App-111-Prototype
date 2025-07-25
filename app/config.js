// Use this file to change prototype configuration.

module.exports = {
  // Service name
  serviceName: 'Service name goes here',

  // Port to run nodemon on locally
  port: 2000,

  // Automatically stores form data, and send to all views
  useAutoStoreData: 'true',

  // Enable cookie-based session store (persists on restart)
  // Please note 4KB cookie limit per domain, cookies too large will silently be ignored
  useCookieSessionStore: 'false',

  frame: {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; Pixel 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.199 Mobile Safari/537.36 nhsapp-android/1.26.2',
    localURLs: ['localhost', '127.0.1', '::1', 'nhs-app-111-prototype'],
    proxyHeaders: [
      'x-content-type-options',
      'x-powered-by',
      'strict-transport-security',
      'referrer-policy',
      'access-control-allow-origin',
      'access-control-allow-credentials',
      'x-frame-options',
      'content-security-policy'
    ]
  }

};
