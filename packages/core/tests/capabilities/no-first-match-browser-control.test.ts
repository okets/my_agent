import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * Lint-style test — `browser-control` is multi-instance.
 *
 * The legacy first-match registry methods (`has`, `get`, `isEnabled`,
 * `toggle`, plus `.find(c => c.provides === ...)`) silently pick a
 * single capability and ignore the rest. For multi-instance types
 * that's a correctness bug.
 *
 * This test scans all .ts/.js source under `packages/` and fails if it
 * finds any of the forbidden patterns referencing `browser-control`.
 *
 * Allowed alternatives:
 *   - `registry.listByProvides('browser-control')`
 *   - `registry.toggleByName(name)`
 *   - `caps.filter(c => c.provides === 'browser-control')`
 */

const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // .find(c => c.provides === 'browser-control')  (and double-quote / various spacing)
  {
    name: ".find(c => c.provides === 'browser-control')",
    regex: /\.find\s*\(\s*[A-Za-z_$][\w$]*\s*=>\s*[A-Za-z_$][\w$]*\.provides\s*===?\s*['"]browser-control['"]/g,
  },
  // registry.get('browser-control')
  {
    name: "registry.get('browser-control')",
    regex: /\.get\s*\(\s*['"]browser-control['"]\s*\)/g,
  },
  // registry.has('browser-control')
  {
    name: "registry.has('browser-control')",
    regex: /\.has\s*\(\s*['"]browser-control['"]\s*\)/g,
  },
  // registry.toggle('browser-control')  — must use toggleByName(name) for multi-instance
  {
    name: "registry.toggle('browser-control')",
    regex: /\.toggle\s*\(\s*['"]browser-control['"]\s*\)/g,
  },
]

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')
const SELF_FILE = basename(import.meta.filename ?? '')

async function findSourceFiles(): Promise<string[]> {
  const { globby } = await import('globby')
  const patterns = ['**/*.ts', '**/*.js']
  const files = await globby(patterns, {
    cwd: PACKAGES_DIR,
    absolute: true,
    gitignore: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      // The test file itself contains the forbidden patterns as string literals.
      `**/${SELF_FILE}`,
      // Regression tests intentionally exercise legacy first-match semantics on
      // browser-control to prove get/has continue to compile and behave for
      // pre-existing call-sites. These are not real consumers.
      '**/registry-multi-instance.test.ts',
    ],
  })
  return files
}

describe('Lint — no first-match browser-control', () => {
  it('disallows .find(c => c.provides === "browser-control") and .get/.has/.toggle("browser-control")', async () => {
    const files = await findSourceFiles()
    expect(files.length).toBeGreaterThan(0)

    const violations: Array<{ file: string; pattern: string; lineNo: number; line: string }> = []

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (const { name, regex } of FORBIDDEN_PATTERNS) {
        regex.lastIndex = 0
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0
          if (regex.test(lines[i])) {
            violations.push({
              file: file.replace(REPO_ROOT + '/', ''),
              pattern: name,
              lineNo: i + 1,
              line: lines[i].trim(),
            })
          }
        }
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map(v => `  ${v.file}:${v.lineNo}\n    pattern: ${v.pattern}\n    line:    ${v.line}`)
        .join('\n')
      throw new Error(
        `Found ${violations.length} forbidden first-match reference(s) to 'browser-control'.\n` +
          `'browser-control' is a multi-instance capability — use registry.listByProvides('browser-control') ` +
          `and registry.toggleByName(name) instead.\n\n` +
          message,
      )
    }
    expect(violations).toEqual([])
  })
})
