require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    moduleResolution: 'node',
  },
});
module.exports = require('./global-teardown.ts').default;
