const assert=require('node:assert/strict');
const {isWebsiteBuildRequest}=require('../src/services/builder/taskRouting');
assert.equal(isWebsiteBuildRequest('Make a modern ecommerce website with five pages'),true);
assert.equal(isWebsiteBuildRequest('redesign landing page'),true);
assert.equal(isWebsiteBuildRequest('Hi, how much is a domain?'),false);
assert.equal(isWebsiteBuildRequest('What is Elementor?'),false);
assert.equal(isWebsiteBuildRequest('Build a product store'),true);
console.log('Hybrid task routing smoke tests passed.');
