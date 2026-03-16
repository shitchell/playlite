/**
 * Example lib: greeter
 *
 * A minimal lib that demonstrates the factory pattern.
 * Does not use `page` — returns static helpers.
 *
 * Usage:
 *   playlite run --lib greeter examples/scripts/hello.ts
 *   playlite eval --lib greeter "console.log(greeting)"
 */

import type { Page } from 'playwright-core';

export default async function (_page: Page) {
  return {
    greeting: 'hello',
    add: (a: number, b: number) => a + b,
  };
}
