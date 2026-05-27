/**
 * Browser Guard Unit Tests
 * 
 * Verifies that the BrowserGuard class correctly intercepts and blocks
 * mutating operations, maintaining absolute read-only safety.
 */

import { BrowserGuard } from '../src/browser-guard.js';

// Simple mock for Playwright's Page object
class MockPage {
  constructor() {
    this.routes = [];
    this.mouse = {
      move: (x, y) => { this.mouseMoved = { x, y }; return Promise.resolve(); }
    };
  }

  route(urlPattern, handler) {
    this.routes.push({ urlPattern, handler });
  }

  evaluate(fn, ...args) {
    this.evaluated = { fn, args };
    return Promise.resolve("mock_result");
  }
}

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        TESTING: BrowserGuard Safety Verification         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, message) => {
    if (condition) {
      console.log(`  ✅  PASSED: ${message}`);
      passed++;
    } else {
      console.log(`  ❌  FAILED: ${message}`);
      failed++;
    }
  };

  // Test 1: Guard installation
  try {
    const page = new MockPage();
    const guard = new BrowserGuard(page);
    await guard.install();
    assert(page.routes.length > 0, "Guard installs route interceptors on the page");
  } catch (err) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // Test 2: Safe operations are allowed
  try {
    const page = new MockPage();
    const guard = new BrowserGuard(page);
    await guard.scroll(500);
    assert(page.evaluated.args[0] === 500, "Scroll operation is allowed and evaluates on page");
    
    await guard.mouseMove(100, 200);
    assert(page.mouseMoved.x === 100 && page.mouseMoved.y === 200, "Mouse movement is allowed");
  } catch (err) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // Test 3: Mutating click operation is blocked
  try {
    const page = new MockPage();
    const guard = new BrowserGuard(page);
    guard.click();
    assert(false, "click() should have thrown an error but did not");
  } catch (err) {
    assert(err.message.includes("BrowserGuard: click() is not allowed"), "click() is successfully blocked with an safety exception");
  }

  // Test 4: Mutating fill/type operations are blocked
  try {
    const page = new MockPage();
    const guard = new BrowserGuard(page);
    guard.fill();
    assert(false, "fill() should have thrown an error but did not");
  } catch (err) {
    assert(err.message.includes("BrowserGuard: fill() is not allowed"), "fill() is successfully blocked with an safety exception");
  }

  console.log(`\n  📊  Tests execution complete: ${passed} passed, ${failed} failed.\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
