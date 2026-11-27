'use strict';

// Pins fixture behavior from the baseline table (기준 상태) in docs/evaluation.md.
// The fixtures contain deliberate faults; a well-meant "fix" would silently invalidate the
// evaluation cases. When a fixture change is intentional, update that table, re-measure
// the rendered rows, and update these expectations in the same change.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const docs = path.resolve(__dirname, '../docs');
const workshop = path.join(docs, 'eval-fixture');
const newPage = path.join(docs, 'eval-new-page');
const report = path.join(docs, 'eval-report');
/** @param {...string} parts */
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

let browser;
test.after(async () => { await browser?.close(); });

async function openPage(t) {
  browser ??= await chromium.launch();
  const page = await browser.newPage({ offline: true, viewport: { width: 1280, height: 800 } });
  t.after(() => page.close());
  return page;
}

async function openFixture(t, directory) {
  const page = await openPage(t);
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
  return page;
}

async function visibleTexts(locator) {
  return locator.evaluateAll((nodes) => nodes
    .filter((node) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map((node) => node.innerText));
}

/**
 * Collect the declarations of each selector in a flat stylesheet (no nested blocks).
 * @param {string} css
 */
function rules(css) {
  /** @type {Map<string, Record<string, string>>} */
  const found = new Map();
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {};
    for (const [, property, value] of body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      declarations[property] = value.trim();
    }
    for (const selector of selectors.split(',')) {
      found.set(selector.trim(), { ...found.get(selector.trim()), ...declarations });
    }
  }
  return found;
}

/** @param {string} csv */
function parseCsv(csv) {
  const [header, ...rows] = csv.trim().split(/\r?\n/).map((line) => line.split(','));
  return rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

/** @param {string} source @param {string} tag */
function elements(source, tag) {
  return [...source.matchAll(new RegExp(`<${tag}\\b([^>]*)>([^<]*)`, 'g'))].map(([, attributes, text]) => ({
    attributes: Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
    text: text.trim(),
  }));
}

/** @param {string} source @param {string} start @param {string} end */
function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing ${end} after ${start}`);
  return source.slice(from, to);
}

// CSS comments and strings can give away the exercise. Bare CSS keywords such as
// "baseline" also occur in ordinary layout declarations and feature queries.
function cssHintText(css) {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\bbaseline\b/gi,
    (token) => token.toLowerCase() === 'baseline' ? '' : token);
}

test('fixture files carry no hints about the evaluation', async (t) => {
  const page = await openPage(t);
  const hint = /평가|채점|기준 상태|eval|baseline|rubric|TODO|FIXME|버그|\bbug/i;
  for (const folder of [workshop, newPage, report]) {
    for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      const source = read(file);
      const extension = path.extname(file).toLowerCase();
      if (extension === '.css') {
        assert.doesNotMatch(cssHintText(source), hint, file);
      } else if (extension === '.html' || extension === '.svg') {
        const mediaType = extension === '.svg' ? 'image/svg+xml' : 'text/html';
        const { markup, styles } = await page.evaluate(({ source, mediaType }) => {
          const doc = new DOMParser().parseFromString(source, mediaType);
          const styles = [];
          if (mediaType === 'image/svg+xml' && doc.querySelector('parsererror')) {
            return { markup: source, styles };
          }
          for (const node of doc.querySelectorAll('style')) {
            styles.push(node.textContent);
            node.textContent = '';
          }
          for (const node of doc.querySelectorAll('[style]')) {
            styles.push(node.getAttribute('style'));
            node.removeAttribute('style');
          }
          // SVG presentation attributes use CSS names and values, e.g. dominant-baseline="auto".
          for (const node of doc.querySelectorAll('svg, svg *')) {
            if (!(node instanceof SVGElement)) continue;
            for (const { name, value } of [...node.attributes]) {
              if (!name.startsWith('--') && CSS.supports(name, value)) {
                styles.push(`${name}: ${value}`);
                node.removeAttribute(name);
              }
            }
          }
          return { markup: new XMLSerializer().serializeToString(doc), styles };
        }, { source, mediaType });
        assert.doesNotMatch(markup, hint, file);
        for (const css of styles) assert.doesNotMatch(cssHintText(css), hint, file);
      } else {
        assert.doesNotMatch(source, hint, file);
      }
    }
  }
});

test('workshop menu keeps the measured box and label gaps at 1280px', async (t) => {
  const page = await openFixture(t, workshop);
  const nav = page.locator('header nav');
  const menu = await nav.locator('a').evaluateAll((links) => {
    const boxes = links.map((link) => link.getBoundingClientRect());
    const labels = links.map((link) => {
      const range = document.createRange();
      range.selectNodeContents(link);
      return range.getBoundingClientRect();
    });
    const gaps = (rects) => rects.slice(1).map((rect, i) => Math.round(rect.left - rects[i].right));
    return {
      links: links.map((link) => [link.getAttribute('href'), link.textContent]),
      boxGaps: gaps(boxes),
      labelGaps: gaps(labels),
    };
  });
  assert.deepEqual(menu.links, [
    ['#services', '서비스'], ['#prices', '요금'], ['#stats', '접수 현황'], ['#booking', '예약하기'],
  ]);

  assert.deepEqual(menu.boxGaps, [6, 20, 34]);
  assert.deepEqual(menu.labelGaps, [14, 28, 52]);
  assert.equal(await nav.evaluate((node) => getComputedStyle(node).whiteSpace), 'nowrap');
});

test('workshop logo, typeface and heading keep their original treatment', async (t) => {
  const source = read(workshop, 'styles.css');
  const page = await openFixture(t, workshop);
  const brand = await page.getByRole('link', { name: '동네수리공방' }).evaluate((link) => {
    const { backgroundImage, backgroundClip, color } = getComputedStyle(link);
    return { backgroundImage, backgroundClip, color };
  });
  assert.deepEqual(brand, {
    backgroundImage: 'linear-gradient(90deg, rgb(109, 40, 217), rgb(192, 38, 211))',
    backgroundClip: 'text',
    color: 'rgba(0, 0, 0, 0)',
  });
  assert.equal(source.match(/font-family\s*:/g)?.length, 1, 'only body declares a font family');
  assert.match(rules(source).get('body')?.['font-family'] ?? '', /^"Pretendard"/);
  assert.doesNotMatch(source, /keep-all/);
  assert.match(read(workshop, 'index.html'), /<h1>고장 난 생활용품, 동네에서 고쳐 드립니다<\/h1>/);
  assert.equal(rules(source).get('.booking-form input')?.border, '1px solid #c9c3d9');
});

test('workshop chart draws the missing April count as zero and has no text alternative', async (t) => {
  const html = read(workshop, 'index.html');
  const svg = between(html, '<svg', '</svg>');
  assert.doesNotMatch(svg, /<title|<desc|role=|aria-/);
  assert.doesNotMatch(between(html, '<section id="stats">', '</section>'), /<table/);
  const page = await openFixture(t, workshop);
  assert.equal(await page.locator('#stats').ariaSnapshot(), [
    '- heading "접수 현황" [level=2]',
    '- figure "2024년 1~6월 월별 수리 접수(건)":',
    '  - img: 80 60 40 20 0 접수(건) 42 38 51 0 64 57 1월 2월 3월 4월 5월 6월',
    '  - text: 2024년 1~6월 월별 수리 접수(건)',
  ].join('\n'), 'chart accessibility tree');

  // Grid lines run top to bottom in the same order as the tick labels.
  const ticks = elements(between(svg, '<g class="ticks">', '</g>'), 'text').map(({ text }) => text);
  const grid = elements(between(svg, '<g class="grid">', '</g>'), 'line').map(({ attributes }) => Number(attributes.y1));
  assert.deepEqual(ticks, ['80', '60', '40', '20', '0']);
  const [topY, zeroY] = [grid[0], grid[grid.length - 1]];
  const perRequest = (zeroY - topY) / 80;
  const bars = elements(between(svg, '<g class="bars">', '</g>'), 'rect').map(({ attributes }) => attributes);
  const values = elements(between(svg, '<g class="values">', '</g>'), 'text');
  const months = elements(between(svg, '<g class="months">', '</g>'), 'text');
  const rows = parseCsv(read(workshop, 'data', 'requests.csv'));

  assert.deepEqual(months.map(({ text }) => text), ['1월', '2월', '3월', '4월', '5월', '6월']);
  assert.equal(bars.length, months.length);
  assert.equal(values.length, months.length);
  assert.deepEqual(rows.map(({ month }) => month), ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06']);
  for (const [i, row] of rows.entries()) {
    const height = Number(bars[i].height);
    const centerX = Number(bars[i].x) + Number(bars[i].width) / 2;
    assert.equal(Number(months[i].attributes.x), centerX, `${row.month} month label centered on bar`);
    assert.equal(Number(values[i].attributes.x), centerX, `${row.month} value centered on bar`);
    assert.equal(Number(bars[i].y) + height, zeroY, `${row.month} bar starts at zero`);
    if (row.month === '2024-04') {
      assert.deepEqual([row.requests, row.note], ['', '접수 시스템 교체로 집계 누락']);
      assert.equal(height, 0);
      assert.equal(values[i].text, '0');
    } else {
      assert.equal(height, Number(row.requests) * perRequest, `${row.month} bar height`);
      assert.equal(values[i].text, row.requests);
    }
  }
  assert.match(html, /<figcaption>2024년 1~6월 월별 수리 접수\(건\)<\/figcaption>/);
});

const booking = { name: '테스트', phone: '01012345678', date: '2025-04-01' };

async function prepareBooking(page) {
  for (const [field, value] of Object.entries(booking)) {
    await page.locator(`#booking-form [name="${field}"]`).fill(value);
  }
  return page.evaluateHandle(() => {
    const calls = [];
    window.fetch = (url, options) => {
      const response = Promise.withResolvers();
      const statusAtFetch = document.getElementById('booking-status').textContent;
      calls.push({ url, options, statusAtFetch, response });
      return response.promise;
    };
    return calls;
  });
}

test('a double click on a valid booking sends two POSTs before a response', async (t) => {
  const page = await openFixture(t, workshop);
  const calls = await prepareBooking(page);
  const submit = page.getByRole('button', { name: '예약 신청' });
  await submit.dblclick();
  const posts = await calls.evaluate((requests) => requests.map(({ url, options }) => [url, options.method]));
  assert.deepEqual(posts, [['api/bookings', 'POST'], ['api/bookings', 'POST']]);
  assert.ok(await submit.isEnabled(), 'submit remains enabled while the requests are pending');
});

for (const failure of ['HTTP 503', 'network rejection']) {
  test(`workshop booking announces success early and discards input after ${failure}`, async (t) => {
    const page = await openFixture(t, workshop);
    const calls = await prepareBooking(page);
    const status = page.locator('#booking-status');
    const form = page.locator('#booking-form');
    const fields = () => form.evaluate((node) => Object.fromEntries(new FormData(node)));
    assert.equal(await status.getAttribute('role'), null);
    assert.equal(await status.getAttribute('aria-live'), null);
    assert.equal(await status.textContent(), '');
    await page.getByRole('button', { name: '예약 신청' }).click();

    const accepted = '예약 신청이 접수되었습니다.';
    const posts = await calls.evaluate((requests) => requests.map(({ url, options, statusAtFetch }) => ({
      url,
      method: options.method,
      contentType: options.headers['Content-Type'],
      body: JSON.parse(options.body),
      statusAtFetch,
    })));
    assert.deepEqual(posts, [{
      url: 'api/bookings', method: 'POST', contentType: 'application/json', body: booking, statusAtFetch: accepted,
    }]);
    assert.deepEqual(await visibleTexts(status), [accepted], 'booking status visible while pending');
    assert.deepEqual(await fields(), booking);

    await calls.evaluate(([{ response }], failure) => {
      if (failure === 'HTTP 503') {
        response.resolve(new Response(null, { status: 503 }));
      } else {
        response.reject(new TypeError('Failed to fetch'));
      }
    }, failure);
    assert.deepEqual(await visibleTexts(status), ['문제가 발생했습니다.'], 'booking status visible after failure');
    assert.deepEqual(await fields(), { name: '', phone: '', date: '' });
  });
}

test('workshop retry check fails only on the first non-retryable 4xx', () => {
  const result = spawnSync(process.execPath, [path.join(workshop, 'server', 'check-retry.js')], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.filter((line) => line.startsWith('ok - ')).length, 12);
  assert.deepEqual(lines.filter((line) => !line.startsWith('ok - ')), [
    'not ok - rejects every non-retryable 4xx without waiting',
    '  Missing expected rejection: HTTP 400 must reject immediately',
  ]);
});

test('library report hides its conditions and source when printed', async (t) => {
  const html = read(report, 'index.html');
  const style = between(html, '<style>', '</style>');
  assert.match(style, /main \{ width: 52rem;/);
  const page = await openFixture(t, report);
  for (const selector of ['.filter', '.notes']) {
    assert.ok(await page.locator(selector).isVisible(), `${selector} visible on screen`);
  }
  const notes = between(html, '<section class="notes">', '</section>');
  assert.match(notes, /솔빛 분관은 5월에 서가 교체로 10일간 휴관했습니다\./);
  assert.match(notes, /<a href="visits\.csv">/);
  const countingRule = page.getByText('한 사람이 여러 번 방문하면 방문할 때마다 한 건으로 셉니다.');
  const reportYear = '2025';
  const branches = ['마루', '솔빛'];
  const filter = page.getByRole('combobox', { name: '분관 선택' });
  const rowHeaders = page.locator('tbody th[scope="row"]');
  const visits = [];
  assert.deepEqual(await visibleTexts(rowHeaders), branches);
  for (const branch of branches) {
    await filter.selectOption({ label: branch });
    await page.emulateMedia({ media: 'print' });
    for (const selector of ['.filter', '.notes']) {
      assert.equal(await page.locator(selector).evaluate((node) => getComputedStyle(node).display), 'none', selector);
    }
    assert.ok(await countingRule.isVisible(), 'repeat-visit counting rule visible in print');
    assert.ok(await page.getByText(`${reportYear}년 2분기`).isVisible(), 'report period visible in print');
    assert.deepEqual(await visibleTexts(rowHeaders), [branch], 'only the selected branch prints');
    const [branchHeader, ...months] = await visibleTexts(page.getByRole('columnheader'));
    assert.equal(branchHeader, '분관');
    assert.deepEqual([...months].sort(), ['4월', '5월', '6월']);
    const counts = await visibleTexts(page.locator('tbody td'));
    assert.equal(counts.length, months.length, `${branch} printed month cells`);
    visits.push(...counts.map((text, i) => [branch, reportYear, months[i], text.replace(/,/g, '')]));
    await page.emulateMedia({ media: 'screen' });
  }
  await filter.selectOption({ label: '전체 분관' });
  assert.deepEqual(await visibleTexts(rowHeaders), branches);
  const csv = parseCsv(read(report, 'visits.csv'));
  const sourceVisits = csv.map((row) => [row['분관'], row['연도'], `${row['월']}월`, row['방문 건수']]);
  assert.deepEqual(visits.sort(), sourceVisits.sort(), 'visit counts by branch, year and month');
  assert.deepEqual(csv.filter((row) => row['비고']).map((row) => [row['분관'], row['월'], row['비고']]), [
    ['솔빛', '5', '서가 교체로 10일간 휴관'],
  ]);
});

test('new-page material describes the booking steps without collecting data', () => {
  const brief = read(newPage, 'brief.md');
  assert.match(brief, /평일 오전 9시부터 오후 6시까지 방문합니다\. 야간·주말 방문은 제공하지 않습니다\./);
  assert.match(brief, /방문 점검은 15,000원이며 수리를 진행하면 수리비에 포함됩니다\./);
  assert.match(brief, /\[예약 안내\]\(booking\.html\)/);
  const booking = read(newPage, 'booking.html');
  assert.doesNotMatch(booking, /<form|<input|<script/);
  assert.match(booking, /양쪽이 시간에 동의하면 예약이 확정됩니다\./);
  assert.deepEqual(fs.readdirSync(newPage).sort(), ['booking.html', 'brief.md']);
});
