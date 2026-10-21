import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { parseAgentUsageSnapshot } from '../src/features/usage/adapters'
import { DEFAULT_USAGE_SETTINGS } from '../src/features/usage/settings'
import type { IAgentUsageSnapshot, IUsageMetricLine, UsageProviderId } from '../src/features/usage/types'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/agy-cli-usage.json', import.meta.url), 'utf8')) as {
  command: { data: { groups: { buckets: { id: string; remaining_fraction: number; reset_time?: string }[] }[] } }
}

const labels: Record<string, string> = {
  'gemini-5h': 'Gemini 5h',
  'gemini-weekly': 'Gemini Weekly',
  '3p-5h': 'Claude and GPT 5h',
  '3p-weekly': 'Claude and GPT Weekly',
}
const lines: IUsageMetricLine[] = fixture.command.data.groups.flatMap((group) =>
  group.buckets.map((bucket) => ({
    type: 'progress',
    label: labels[bucket.id],
    used: (1 - bucket.remaining_fraction) * 100,
    limit: 100,
    resetsAt: 'reset_time' in bucket ? bucket.reset_time : undefined,
  })),
)
const snapshot: IAgentUsageSnapshot = { providerId: 'agy', lines }
const parse = (customLines = lines, providerId: UsageProviderId = 'agy') =>
  parseAgentUsageSnapshot(providerId, { ...snapshot, lines: customLines }, DEFAULT_USAGE_SETTINGS)

test('AGY fixture preserves real fractions, resets and weekly-dependent availability', () => {
  const metrics = parse().metrics
  expect(metrics.find((metric) => metric.label === 'Gemini 5h')).toMatchObject({
    value: 98.67,
    statusLabel: 'Available',
    remainingLabel: '98.67% remaining',
  })
  expect(metrics.find((metric) => metric.label === 'Gemini Weekly')).toMatchObject({ value: 60.44 })
  expect(metrics.find((metric) => metric.label === 'Claude and GPT 5h')).toMatchObject({
    value: 100,
    statusLabel: 'Blocked by weekly limit',
    statusLevel: 'danger',
    remainingLabel: '100% remaining',
    resetLabel: null,
  })
  expect(metrics.find((metric) => metric.label === 'Claude and GPT Weekly')).toMatchObject({
    value: 0,
    statusLabel: 'Exhausted',
  })
  const used = parseAgentUsageSnapshot('agy', snapshot, { ...DEFAULT_USAGE_SETTINGS, usageMode: 'used' })
  expect(used.metrics.find((metric) => metric.label === 'Claude and GPT 5h')).toMatchObject({
    value: 0,
    statusLabel: 'Blocked by weekly limit',
    remainingLabel: '0% used',
  })
})

test('AGY does not invent exhausted weekly quota from missing or unknown data', () => {
  const fiveHour = lines.filter((line) => line.label === 'Claude and GPT 5h')
  for (const weekly of [
    [],
    [{ type: 'progress', label: 'Claude and GPT Weekly' }],
    [{ type: 'progress', label: 'Claude and GPT Weekly', used: Number.NaN, limit: 100 }],
    [{ type: 'progress', label: 'Claude and GPT Weekly', used: 100, limit: 0 }],
    [{ type: 'progress', label: 'Claude and GPT Weekly', used: 99.999, limit: 100 }],
    [{ type: 'progress', label: 'Gemini Weekly', used: 100, limit: 100 }],
  ]) {
    expect(parse([...fiveHour, ...weekly]).metrics[0]).toMatchObject({ statusLabel: 'Available' })
  }
})

test('weekly dependency and fractional display do not change other providers', () => {
  for (const providerId of ['codex', 'claude', 'cursor'] as const) {
    const metrics = parse(lines, providerId).metrics
    expect(metrics.find((metric) => metric.label === 'Claude and GPT 5h')?.statusLabel).toBe('Available')
    expect(metrics.find((metric) => metric.label === 'Gemini Weekly')?.value).toBe(60)
  }
})

test('AGY renders weekly-blocked 5h without inventing a reset or available quota', async ({ page }) => {
  await page.addInitScript((usageSnapshot) => {
    ;(window as typeof window & { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === 'notch_metrics') return [184, 36]
        if (command === 'set_keep_awake') return false
        if (command === 'set_panel_open') return true
        if (command === 'agy_usage') return usageSnapshot
        throw new Error(`${command} unavailable`)
      },
    }
  }, snapshot)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open Agent Halo' }).click()
  await page.getByRole('tab', { name: 'Usage' }).click()
  const card = page.getByRole('region', { name: 'Antigravity usage' })
  await expect(card.getByText('98.67% remaining')).toBeVisible()
  await expect(card.getByText('60.44% remaining')).toBeVisible()
  await expect(card.getByText('Blocked by weekly limit')).toBeVisible()
  await expect(card.getByText('Quota available')).toHaveCount(0)
})
