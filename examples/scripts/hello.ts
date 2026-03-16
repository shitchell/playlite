// Example script for `playlite run --lib greeter examples/scripts/hello.ts`
// Requires a running browser (playlite launch) and the greeter lib.
//
// Demonstrates: accessing lib exports + page globals.

console.log(`greeting: ${greeting}`);
console.log(`add(2, 3): ${add(2, 3)}`);
console.log(`page title: ${await page.title()}`);
console.log(`page url: ${page.url()}`);
