// Only used by jest-expo's babel-jest transform for tests — Metro (dev/
// build) on SDK 52+ compiles without a babel.config.js by default.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
