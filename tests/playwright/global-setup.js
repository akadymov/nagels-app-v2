// Thin CommonJS shim so playwright.config.js can wire a .ts file as
// globalSetup without us needing ts-jest at runtime. We force
// module=commonjs because the root tsconfig extends expo/tsconfig.base
// which emits esnext — require() would reject that.
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
module.exports = require('./global-setup.ts').default;
