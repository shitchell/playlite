/**
 * Second test lib — overlaps with test-lib to test collision warnings.
 */

export default async function (_page: unknown) {
  return {
    greeting: 'world',   // collides with test-lib's greeting
    multiply: (a: number, b: number) => a * b,
  };
}
