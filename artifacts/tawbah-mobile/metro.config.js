const path = require('path');
const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const appRoot = path.join(projectRoot, 'app');

process.env.EXPO_ROUTER_APP_ROOT = appRoot;

const config = getDefaultConfig(projectRoot);

config.resolver.unstable_enablePackageExports = true;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolution = context.resolveRequest(context, moduleName, platform);
  if (
    platform === 'web' &&
    resolution.type === 'sourceFile' &&
    /\/react-native-worklets\/(?:lib\/module|src)\/PlatformChecker\/index\.(?:js|ts)$/.test(
      resolution.filePath,
    )
  ) {
    return {
      type: 'sourceFile',
      filePath: path.join(projectRoot, 'src/polyfills/worklets-platform-checker.js'),
    };
  }
  return resolution;
};

config.resolver.blockList = [
  /node_modules\/expo-asset_tmp_[^/]+\/.*/,
  /node_modules\/.*_tmp_[^/]+\/.*/,
  // Exclude backup directories from being watched by Metro
  /artifacts\/tawbah-mobile-backup\/.*/,
  /tawbah-mobile-backup\/.*/,
];

config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

const origCustomTransformOptions = config.transformer.customTransformOptions || {};
config.transformer.customTransformOptions = {
  ...origCustomTransformOptions,
  routerRoot: appRoot,
};

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/api/')) {
        const apiPort = 3001;
        const options = {
          hostname: 'localhost',
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: `localhost:${apiPort}`,
          },
        };

        const proxy = http.request(options, (apiRes) => {
          res.writeHead(apiRes.statusCode, {
            ...apiRes.headers,
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'Content-Type, Authorization',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          });
          apiRes.pipe(res, { end: true });
        });

        proxy.on('error', (err) => {
          console.error('[API Proxy] Error:', err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'API server unavailable' }));
        });

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          req.pipe(proxy, { end: true });
        } else {
          proxy.end();
        }
        return;
      }

      return metroMiddleware(req, res, next);
    };
  },
};

module.exports = config;
