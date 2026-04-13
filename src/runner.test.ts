import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  splitImports,
  generatePageSelection,
  generateLibLoading,
  generateWrapper,
} from './runner.js';

// ---------------------------------------------------------------------------
// splitImports
// ---------------------------------------------------------------------------
describe('splitImports', () => {
  it('hoists a single-line named import', () => {
    const src = `import { Foo } from 'bar';`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import { Foo } from 'bar';`);
    assert.equal(body, '');
  });

  it('hoists a multi-line import spanning lines', () => {
    const src = [
      `import {`,
      `  Foo,`,
      `  Bar,`,
      `} from 'baz';`,
    ].join('\n');
    const { imports, body } = splitImports(src);
    assert.equal(imports, src);
    assert.equal(body, '');
  });

  it('hoists a side-effect import', () => {
    const src = `import 'foo';`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import 'foo';`);
    assert.equal(body, '');
  });

  it('hoists import type declarations', () => {
    const src = `import type { Foo } from 'bar';`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import type { Foo } from 'bar';`);
    assert.equal(body, '');
  });

  it('hoists import{Foo} (no space after import)', () => {
    const src = `import{Foo} from 'bar';`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import{Foo} from 'bar';`);
    assert.equal(body, '');
  });

  it('separates imports from body code', () => {
    const src = [
      `import { Foo } from 'bar';`,
      `import 'side-effect';`,
      `const x = 1;`,
      `console.log(x);`,
    ].join('\n');
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import { Foo } from 'bar';\nimport 'side-effect';`);
    assert.equal(body, `const x = 1;\nconsole.log(x);`);
  });

  it('returns empty imports and full body when no imports present', () => {
    const src = `const x = 1;\nconsole.log(x);`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, '');
    assert.equal(body, src);
  });

  it('keeps export lines in body (not hoisted)', () => {
    const src = [
      `import { Foo } from 'bar';`,
      `export const x = 1;`,
      `export default function main() {}`,
    ].join('\n');
    const { imports, body } = splitImports(src);
    assert.equal(imports, `import { Foo } from 'bar';`);
    assert.ok(body.includes('export const x = 1;'));
    assert.ok(body.includes('export default function main() {}'));
  });

  it('does not hoist code starting with "import" that is not an import', () => {
    const src = `importFoo();\nimportBar.run();`;
    const { imports, body } = splitImports(src);
    assert.equal(imports, '');
    assert.equal(body, src);
  });
});

// ---------------------------------------------------------------------------
// generatePageSelection
// ---------------------------------------------------------------------------
describe('generatePageSelection', () => {
  it('generates single-page selection when no tab filter given', () => {
    const result = generatePageSelection(undefined);
    assert.ok(result.includes('__pages.length === 0'));
    assert.ok(result.includes('__pages.length > 1'));
    assert.ok(result.includes('page = __pages[0]'));
  });

  it('generates index-based selection for numeric tab string', () => {
    const result = generatePageSelection('2');
    assert.ok(result.includes('2 - 1'));
    assert.ok(result.includes('__tabIdx'));
    assert.ok(result.includes('__pages[__tabIdx]'));
    // Should still have the 0-pages check
    assert.ok(result.includes('__pages.length === 0'));
  });

  it('generates title-matching selection for string tab filter', () => {
    const result = generatePageSelection('Asset Suite');
    assert.ok(result.includes('__titles'));
    assert.ok(result.includes('toLowerCase'));
    assert.ok(result.includes('asset suite')); // lowercased filter
    assert.ok(result.includes('__matches'));
    assert.ok(result.includes('page = __matches[0]'));
    // Should error on no matches
    assert.match(result, /No tab matching/);
    // Should error on multiple matches
    assert.match(result, /Multiple tabs match/);
  });
});

// ---------------------------------------------------------------------------
// generateLibLoading
// ---------------------------------------------------------------------------
describe('generateLibLoading', () => {
  it('returns empty string for empty libs array', () => {
    const result = generateLibLoading([], '/some/dir/.playlite');
    assert.equal(result, '');
  });

  it('generates import and factory call for a single lib', () => {
    const result = generateLibLoading(['helpers'], '/project/.playlite');
    assert.ok(result.includes('file:///project/.playlite/libs/helpers.ts'));
    assert.ok(result.includes('__lib_helpers'));
    assert.ok(result.includes('.default(page)'));
    assert.ok(result.includes('Object.assign(globalThis, __mergedExports)'));
  });

  it('generates code for multiple libs', () => {
    const result = generateLibLoading(['helpers', 'utils'], '/project/.playlite');
    assert.ok(result.includes('file:///project/.playlite/libs/helpers.ts'));
    assert.ok(result.includes('file:///project/.playlite/libs/utils.ts'));
    assert.ok(result.includes('__lib_helpers'));
    assert.ok(result.includes('__lib_utils'));
  });

  it('throws when libs are requested but playliteDir is null', () => {
    assert.throws(
      () => generateLibLoading(['helpers'], null),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('.playlite/'));
        return true;
      },
    );
  });

  it('sanitizes lib names with special characters', () => {
    const result = generateLibLoading(['my-lib'], '/project/.playlite');
    // hyphen should become underscore
    assert.ok(result.includes('__lib_my_lib'));
    assert.ok(!result.includes('__lib_my-lib'));
  });
});

// ---------------------------------------------------------------------------
// generateWrapper
// ---------------------------------------------------------------------------
describe('generateWrapper', () => {
  /**
   * Helper to assert common wrapper boilerplate is present.
   */
  function assertWrapperBoilerplate(wrapper: string, port: number) {
    assert.ok(
      wrapper.includes("import { chromium } from 'playwright-core'"),
      'should import chromium from playwright-core',
    );
    assert.ok(
      wrapper.includes(`chromium.connectOverCDP('http://localhost:${port}')`),
      'should connect over CDP with correct port',
    );
    assert.match(wrapper, /__name.*=.*\(fn: any\).*=>.*fn/, 'should include __name polyfill');
    assert.ok(
      wrapper.includes('browser.close()'),
      'should close browser in finally',
    );
  }

  it('generates wrapper for inline code with no libs', () => {
    const wrapper = generateWrapper(
      { port: 9222, libs: [], code: 'console.log("hi");', isFile: false },
      null,
    );
    assertWrapperBoilerplate(wrapper, 9222);
    assert.ok(wrapper.includes('console.log("hi")'));
    // Should have try/finally structure
    assert.ok(wrapper.includes('try {'));
    assert.ok(wrapper.includes('} finally {'));
  });

  it('generates wrapper with lib loading section', () => {
    const wrapper = generateWrapper(
      { port: 9222, libs: ['helpers'], code: 'doStuff();', isFile: false },
      '/project/.playlite',
    );
    assertWrapperBoilerplate(wrapper, 9222);
    assert.ok(wrapper.includes('file:///project/.playlite/libs/helpers.ts'));
    assert.ok(wrapper.includes('doStuff()'));
  });

  it('generates wrapper with tab filter', () => {
    const wrapper = generateWrapper(
      { port: 9222, tab: 'MyApp', libs: [], code: 'page.title();', isFile: false },
      null,
    );
    assertWrapperBoilerplate(wrapper, 9222);
    // Should have title-matching page selection
    assert.ok(wrapper.includes('__titles'));
    assert.ok(wrapper.includes('myapp')); // lowercased
  });

  it('hoists user imports outside the IIFE', () => {
    const userCode = [
      `import { something } from 'some-package';`,
      `console.log(something);`,
    ].join('\n');
    const wrapper = generateWrapper(
      { port: 9222, libs: [], code: userCode, isFile: false },
      null,
    );
    assertWrapperBoilerplate(wrapper, 9222);
    // The user import should appear before the IIFE
    const iifeIndex = wrapper.indexOf('(async () => {');
    const userImportIndex = wrapper.indexOf("import { something } from 'some-package'");
    assert.ok(userImportIndex !== -1, 'user import should be present');
    assert.ok(userImportIndex < iifeIndex, 'user import should appear before the IIFE');
    // The body should be inside the IIFE
    assert.ok(wrapper.indexOf('console.log(something)') > iifeIndex);
  });

  it('reads from file when isFile is true', () => {
    const tmpPath = join(
      '/tmp',
      `playlite-test-${randomBytes(4).toString('hex')}.ts`,
    );
    const fileContent = `import { foo } from 'bar';\nconsole.log(foo);`;
    writeFileSync(tmpPath, fileContent, 'utf8');

    try {
      const wrapper = generateWrapper(
        { port: 9222, libs: [], code: tmpPath, isFile: true },
        null,
      );
      assertWrapperBoilerplate(wrapper, 9222);
      // Should contain the file's hoisted import
      assert.ok(wrapper.includes("import { foo } from 'bar'"));
      // Should contain the file's body
      assert.ok(wrapper.includes('console.log(foo)'));
    } finally {
      unlinkSync(tmpPath);
    }
  });
});
