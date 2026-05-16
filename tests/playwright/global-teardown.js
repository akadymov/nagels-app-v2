require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    moduleResolution: 'node',
    allowImportingTsExtensions: false,
  },
});
module.exports = require('./global-teardown.ts').default;
