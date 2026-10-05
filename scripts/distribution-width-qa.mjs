import assert from 'node:assert/strict';

export async function verifyDistributionWidths(page) {
  const rows = await page.locator('.disease-distribution-bars li').evaluateAll(rows => rows.map(row => ({
    name: row.querySelector('span').textContent,
    label: row.querySelector('strong').textContent,
    width: row.querySelector('.disease-distribution-fill').getBoundingClientRect().width,
    track: row.querySelector('.disease-distribution-track').getBoundingClientRect().width,
  })));
  for (const row of rows) {
    assert.ok(row.track > 0, `${row.name}: bar track is not rendered`);
    if (row.label === '0') assert.equal(row.width, 0, `${row.name}: zero count renders a filled bar`);
    else assert.ok(row.width > 0 && row.width <= row.track + 1, `${row.name}: invalid rendered width`);
  }
  const numeric = rows.filter(row => row.label !== 'Disamarkan').map(row => {
    const numbers = row.label.split('–').map(value => Number(value.replaceAll('.', '')));
    return { ...row, minimum: numbers[0], maximum: numbers.at(-1), ratio: row.width / row.track };
  });
  for (const lower of numeric) for (const higher of numeric) {
    if (lower.maximum < higher.minimum) assert.ok(lower.ratio < higher.ratio, `${lower.name}/${higher.name}: bar widths do not distinguish different published counts`);
  }
}
