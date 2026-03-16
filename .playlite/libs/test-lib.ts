/**
 * Test lib for verifying the lib loading system.
 * Does not use `page` — just returns static helpers.
 */

export default async function (_page: unknown) {
  return {
    greeting: 'hello',
    add: (a: number, b: number) => a + b,
  };
}
