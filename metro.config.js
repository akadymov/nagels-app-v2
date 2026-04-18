const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .mjs extension support for React Native 0.76.x module resolution
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs'];

module.exports = config;
