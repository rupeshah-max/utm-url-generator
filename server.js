const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
process.env.PUPPETEER_CACHE_DIR = "/opt/render/project/src/.cache/puppeteer";
const puppeteer = require('puppeteer');
const proxyChain = require('proxy-chain');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5500;
const HOST = process.env.HOST || localhost;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- User agents ----------
// Expanded pool per device category so each request gets a genuinely varied fingerprint.

const USER_AGENTS = {
  mobile: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 SamsungBrowser/25.0',
    'Mozilla/5.0 (Linux; Android 13; moto g power (2023)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  ],
  tablet: [
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-T970) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; Lenovo TB350FU) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ],
  desktop: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ],
};

// ---------- Viewport spoofing ----------
// Paired with device category so a mobile UA never gets a 1920x1080 viewport.

const VIEWPORTS = {
  desktop: [
    { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { width: 1536, height: 864, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  ],
  mobile: [
    { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    { width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
    { width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    { width: 414, height: 896, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { width: 393, height: 852, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
  ],
  tablet: [
    { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { width: 800, height: 1280, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ],
};

const COUNTRY_PROXIES = {
  US: process.env.US_NIMBLE_PROXY,
  GB: process.env.GB_NIMBLE_PROXY,
  RU: process.env.RU_NIMBLE_PROXY,
  BY: process.env.BY_NIMBLE_PROXY,
  IN: process.env.IN_NIMBLE_PROXY,
  BR: process.env.BR_NIMBLE_PROXY,
  DE: process.env.DE_NIMBLE_PROXY,
  CA: process.env.CA_NIMBLE_PROXY,
  AU: process.env.AU_NIMBLE_PROXY,
  JP: process.env.JP_NIMBLE_PROXY,
  FR: process.env.FR_NIMBLE_PROXY,
  HU: process.env.HU_NIMBLE_PROXY,
  SK: process.env.SK_NIMBLE_PROXY
};

// Keywords that show up in the "org"/"isp"/"as" field of IP-info responses when the
// exit IP belongs to a cloud/hosting provider rather than a residential/mobile ISP.
// If we see one of these where a residential exit was expected, the proxy likely
// failed open and traffic went out some server's real IP instead (a "leak").
const HOSTING_PROVIDER_KEYWORDS = [
  'amazon', 'aws', 'google cloud', 'google llc', 'gcp', 'microsoft', 'azure',
  'digitalocean', 'ovh', 'hetzner', 'linode', 'akamai', 'vultr', 'contabo',
  'scaleway', 'oracle cloud', 'alibaba cloud', 'tencent cloud', 'ibm cloud',
  'leaseweb', 'choopa', 'hostinger', 'godaddy',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildProxyUrl(country = 'US') {
  const proxyUser = COUNTRY_PROXIES[country.toUpperCase()];

  const {
    NIMBLE_PASSWORD,
    NIMBLE_HOST,
    NIMBLE_PORT,
  } = process.env;

  if (!proxyUser) {
    throw new Error(`No proxy configured for country: ${country}`);
  }

  if (!NIMBLE_PASSWORD || !NIMBLE_HOST || !NIMBLE_PORT) {
    throw new Error('Missing Nimble proxy credentials in .env');
  }

  return `http://${proxyUser}:${NIMBLE_PASSWORD}@${NIMBLE_HOST}:${NIMBLE_PORT}`;
}

function normalizeInputUrl(url) {
  const u = String(url || '').trim();

  if (!u) {
    throw new Error('Campaign URL is required');
  }

  try {
    return new URL(u).toString();
  } catch {
    throw new Error('Campaign URL must be a valid URL (include https://)');
  }
}

function isHostingProviderOrg(org) {
  if (!org) return false;
  const lower = org.toLowerCase();
  return HOSTING_PROVIDER_KEYWORDS.some((k) => lower.includes(k));
}

// ---------- Bulk import batch tracking (for console visibility only) ----------
// The client processes rows in batches, but each row is still its own stateless
// API call. It attaches import metadata (importId/batchIndex/rowNumber/etc.) to
// each request so the server can log per-row progress and detect when a whole
// batch — or the whole import — has finished, even though requests within a
// batch resolve concurrently and in no guaranteed order.

const importTracking = new Map(); // importId -> tracking record

function trackImportProgress({
  importId,
  rowNumber,
  totalRows,
  batchIndex,
  totalBatches,
  batchRowNumbers,
  campaignName,
  success,
}) {
  if (!importId) return;

  if (!importTracking.has(importId)) {
    importTracking.set(importId, {
      totalRows: totalRows || 0,
      totalBatches: totalBatches || 0,
      completedCount: 0,
      batches: new Map(),
    });
  }

  const record = importTracking.get(importId);
  if (totalRows) record.totalRows = totalRows;
  if (totalBatches) record.totalBatches = totalBatches;

  const idx = batchIndex ?? 0;

  if (!record.batches.has(idx)) {
    record.batches.set(idx, {
      size: (batchRowNumbers || []).length,
      rowNumbers: batchRowNumbers || [],
      completed: 0,
    });
  }

  const batch = record.batches.get(idx);
  batch.completed += 1;
  record.completedCount += 1;

  console.log(
    `[Import ${importId}] Row ${rowNumber ?? '?'}/${record.totalRows} ${success ? 'done' : 'FAILED'} — "${campaignName || 'untitled'}" (batch ${idx + 1}/${record.totalBatches})`
  );

  if (batch.size > 0 && batch.completed >= batch.size) {
    const range = batch.rowNumbers.length
      ? `rows ${Math.min(...batch.rowNumbers)}-${Math.max(...batch.rowNumbers)}`
      : 'rows unknown';

    console.log(
      `[Import ${importId}] ✅ Batch ${idx + 1}/${record.totalBatches} complete — ${range} (${batch.size} urls). Progress: ${record.completedCount}/${record.totalRows} rows total.`
    );
  }

  if (record.totalRows > 0 && record.completedCount >= record.totalRows) {
    console.log(
      `[Import ${importId}] 🎉 Import complete — all ${record.totalRows}/${record.totalRows} rows processed across ${record.totalBatches} batches.`
    );
    importTracking.delete(importId);
  }
}

function pickUserAgentAndViewport(uaType) {
  const requested = uaType || 'random';
  const available = Object.keys(USER_AGENTS);
  const category = requested === 'random' ? pickRandom(available) : (USER_AGENTS[requested] ? requested : 'desktop');

  const userAgent = pickRandom(USER_AGENTS[category]);
  const viewport = pickRandom(VIEWPORTS[category]);

  return { category, userAgent, viewport };
}

// ---------- Proxy country / leak verification ----------

async function fetchJsonViaPage(page, url, timeout = 12000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const text = await page.evaluate(() => document.body.innerText);
  return JSON.parse(text);
}

// Checks the proxy's real exit IP/country through the same page (same proxy tunnel)
// that will be used for the actual navigation, so what we verify is what actually runs.
async function verifyProxyCountry(page, expectedCountry) {
  const services = [
    {
      url: 'https://ipapi.co/json/',
      map: (d) => ({ ip: d.ip, country: d.country_code, org: d.org, source: 'ipapi.co' }),
    },
    {
      url: 'https://ip-api.com/json/',
      map: (d) => ({ ip: d.query, country: d.countryCode, org: d.isp || d.org || d.as, source: 'ip-api.com' }),
    },
    {
      url: 'https://ifconfig.co/json',
      map: (d) => ({ ip: d.ip, country: d.country_iso, org: d.asn_org, source: 'ifconfig.co' }),
    },
  ];

  for (const svc of services) {
    try {
      const raw = await fetchJsonViaPage(page, svc.url);
      const info = svc.map(raw);

      if (!info.country) continue;

      const actualCountry = String(info.country).toUpperCase();
      const expected = String(expectedCountry).toUpperCase();
      const leakSuspected = isHostingProviderOrg(info.org);

      return {
        checked: true,
        source: info.source,
        expectedCountry: expected,
        actualCountry,
        matched: actualCountry === expected,
        ip: info.ip || null,
        org: info.org || null,
        leakSuspected,
      };
    } catch {
      continue; // try the next service
    }
  }

  return {
    checked: false,
    expectedCountry: String(expectedCountry).toUpperCase(),
    actualCountry: null,
    matched: null,
    ip: null,
    org: null,
    leakSuspected: null,
    error: 'All IP-check services failed or timed out',
  };
}

function logProxyCheck(proxyCheck, country) {
  console.log('---------------- Proxy verification ----------------');
  console.log('Expected country :', country);

  if (!proxyCheck.checked) {
    console.log('Status           : COULD NOT VERIFY —', proxyCheck.error);
  } else {
    console.log('Exit IP          :', proxyCheck.ip);
    console.log('Exit country     :', proxyCheck.actualCountry, `(via ${proxyCheck.source})`);
    console.log('ISP / Org        :', proxyCheck.org || 'unknown');
    console.log('Country match    :', proxyCheck.matched ? 'YES' : 'NO — mismatch!');

    if (proxyCheck.leakSuspected) {
      console.log('⚠️  LEAK WARNING  : exit IP org looks like a cloud/hosting provider, not a residential/mobile ISP.');
      console.log('                    This usually means the proxy failed open and traffic left via a server IP.');
    }
  }
  console.log('------------------------------------------------------');
}

async function fetchFinalUrl({
  campaignUrl,
  country = 'US',
  userAgentType,
}) {
  const inputUrl = normalizeInputUrl(campaignUrl);

  const proxyUrl = buildProxyUrl(country);
  const anonymizedProxy = await proxyChain.anonymizeProxy(proxyUrl);

  const { category, userAgent, viewport } = pickUserAgentAndViewport(userAgentType);

  console.log('----------------------------------------');
  console.log('Campaign URL :', inputUrl);
  console.log('Country      :', country);
  console.log('Proxy User   :', COUNTRY_PROXIES[country.toUpperCase()]);
  console.log('UA Category  :', category);
  console.log('User Agent   :', userAgent);
  console.log('Viewport     :', `${viewport.width}x${viewport.height} (scale ${viewport.deviceScaleFactor}, mobile=${viewport.isMobile})`);
  console.log('----------------------------------------');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: "/opt/render/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome",
    args: [
      `--proxy-server=${anonymizedProxy}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  try {
    const page = await browser.newPage();
    const redirectChain = [];
    const seenRedirectUrls = new Set();
    let recordingCampaignNavigation = false;

    const recordUrl = (url, baseUrl = inputUrl) => {
      if (!recordingCampaignNavigation) return;
      if (!url) return;

      let normalized;
      try {
        normalized = new URL(url, baseUrl).toString();
      } catch {
        normalized = String(url);
      }

      if (seenRedirectUrls.has(normalized)) return;
      seenRedirectUrls.add(normalized);
      redirectChain.push(normalized);
    };

    page.setDefaultNavigationTimeout(30000);

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const type = req.resourceType();
      // Skip heavy resources
      if ( type === 'image' || type === 'font' || type === 'media') {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        console.log('Navigated:', frame.url());
        recordUrl(frame.url());
      }
    });

    page.on('response', (response) => {
      try {
        const status = response.status();
        if (status < 300 || status >= 400) return;

        const location = response.headers()['location'];
        if (location) {
          recordUrl(response.url());
          recordUrl(location, response.url());
        }
      } catch {
        // ignore
      }
    });

    await page.setUserAgent(userAgent);
    await page.setViewport(viewport);

    // Verify the proxy's real exit country BEFORE running the actual campaign
    // navigation, using this same page so it reflects the exact tunnel in use.
    const proxyCheck = await verifyProxyCountry(page, country);
    logProxyCheck(proxyCheck, country);

    recordingCampaignNavigation = true;
    recordUrl(inputUrl);

    try {
      await page.goto(inputUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
    } catch (err) {
      console.log('Navigation timeout, continuing...');
    }

    // Wait for client-side redirects
    await sleep(10000);

    const finalUrl = page.url();
    recordUrl(finalUrl);

    console.log('Final URL    :', finalUrl);

    return {
      finalUrl,
      redirectChain,
      proxyCheck,
      userAgent,
      viewport,
    };
  } finally {
    await browser.close();
    await proxyChain.closeAnonymizedProxy(anonymizedProxy, true);
  }
}

app.post('/api/fetch-final-url', async (req, res) => {
  const {
    campaignUrl,
    country,
    userAgentType,
    // Optional bulk-import metadata — absent for single "Add Campaign" submits.
    importId,
    rowNumber,
    totalRows,
    batchIndex,
    totalBatches,
    batchRowNumbers,
    campaignName,
  } = req.body || {};

  const importMeta = { importId, rowNumber, totalRows, batchIndex, totalBatches, batchRowNumbers, campaignName };

  try {
    const { finalUrl, redirectChain, proxyCheck, userAgent, viewport } = await fetchFinalUrl({
      campaignUrl,
      country,
      userAgentType,
    });

    if (importId) trackImportProgress({ ...importMeta, success: true });

    res.json({
      success: true,
      finalUrl,
      redirectChain,
      proxyCheck,
      userAgent,
      viewport,
    });
  } catch (err) {
    console.error(err);

    if (importId) trackImportProgress({ ...importMeta, success: false });

    res.status(400).json({
      success: false,
      error: true,
      message: err.message,
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
  });
});

// =====================================================================
// ---------- Scheduled tasks (bulk CSV/XLSX runs scheduled for later) --
// =====================================================================
//
// Storage: a flat JSON file on disk. Tasks are processed by a polling
// scheduler loop (setInterval) rather than a real cron/queue system, which
// is fine at this scale and keeps things dependency-free.

const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'scheduled-tasks.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load scheduled tasks file, starting empty:', err.message);
    return [];
  }
}

let saveQueued = false;
function saveTasks() {
  // Coalesce rapid successive saves (e.g. many rows finishing near-simultaneously)
  // into a single write on the next tick.
  if (saveQueued) return;
  saveQueued = true;
  setImmediate(() => {
    saveQueued = false;
    try {
      fs.writeFileSync(TASKS_FILE, JSON.stringify(scheduledTasks, null, 2));
    } catch (err) {
      console.error('Failed to persist scheduled tasks:', err.message);
    }
  });
}

let scheduledTasks = loadTasks();

function summarizeTask(task) {
  return {
    id: task.id,
    fileName: task.fileName,
    createdAt: task.createdAt,
    scheduledAt: task.scheduledAt,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    status: task.status,
    cancelRequested: !!task.cancelRequested,
    totalRows: task.rows.length,
    completedRows: task.rows.filter((r) => r.status !== 'pending').length,
    successCount: task.rows.filter((r) => r.status === 'success').length,
    failedCount: task.rows.filter((r) => r.status === 'failed').length,
  };
}

function validateScheduledRow(row, rowNumber) {
  const errors = [];
  if (!row.campaignUrl) errors.push('missing Campaign URL');
  if (!row.country) errors.push('missing Country');
  if (errors.length) throw new Error(`Row ${rowNumber}: ${errors.join(', ')}`);
}

app.post('/api/scheduled-tasks', (req, res) => {
  try {
    const { fileName, scheduledAt, rows, runNow } = req.body || {};

    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, message: 'At least one row is required.' });
    }

    rows.forEach((r, i) => validateScheduledRow(r, r.rowNumber || i + 1));

    const scheduledAtMs = runNow ? Date.now() : new Date(scheduledAt).getTime();
    if (!runNow && (!scheduledAt || Number.isNaN(scheduledAtMs))) {
      return res.status(400).json({ success: false, message: 'A valid scheduledAt date/time is required.' });
    }

    const task = {
      id: newId(),
      fileName: fileName || 'Untitled import',
      createdAt: Date.now(),
      scheduledAt: scheduledAtMs,
      startedAt: null,
      completedAt: null,
      status: 'pending',
      cancelRequested: false,
      rows: rows.map((r, i) => ({
        rowNumber: r.rowNumber || i + 1,
        campaignUrl: r.campaignUrl,
        campaignName: r.campaignName || '',
        country: r.country,
        userAgentType: r.userAgentType || 'random',
        tagsNotes: r.tagsNotes || '',
        status: 'pending',
        finalUrl: '',
        redirectChain: [],
        errorMessage: '',
        generatedAt: null,
      })),
    };

    scheduledTasks.unshift(task);
    saveTasks();

    res.json({ success: true, task: summarizeTask(task) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/scheduled-tasks', (_req, res) => {
  res.json({ success: true, tasks: scheduledTasks.map(summarizeTask) });
});

app.get('/api/scheduled-tasks/:id', (req, res) => {
  const task = scheduledTasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });
  res.json({ success: true, task });
});

app.put('/api/scheduled-tasks/:id', (req, res) => {
  const task = scheduledTasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  if (task.status !== 'pending') {
    return res.status(400).json({ success: false, message: `Cannot edit a task that is ${task.status}.` });
  }

  try {
    const { fileName, scheduledAt, rows } = req.body || {};

    if (fileName) task.fileName = fileName;

    if (scheduledAt) {
      const ms = new Date(scheduledAt).getTime();
      if (Number.isNaN(ms)) throw new Error('Invalid scheduledAt date/time.');
      task.scheduledAt = ms;
    }

    if (Array.isArray(rows) && rows.length) {
      rows.forEach((r, i) => validateScheduledRow(r, r.rowNumber || i + 1));
      task.rows = rows.map((r, i) => ({
        rowNumber: r.rowNumber || i + 1,
        campaignUrl: r.campaignUrl,
        campaignName: r.campaignName || '',
        country: r.country,
        userAgentType: r.userAgentType || 'random',
        tagsNotes: r.tagsNotes || '',
        status: 'pending',
        finalUrl: '',
        redirectChain: [],
        errorMessage: '',
        generatedAt: null,
      }));
    }

    saveTasks();
    res.json({ success: true, task: summarizeTask(task) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.delete('/api/scheduled-tasks/:id', (req, res) => {
  const task = scheduledTasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  if (task.status === 'processing') {
    return res.status(400).json({ success: false, message: 'Cancel the task before deleting it.' });
  }

  scheduledTasks = scheduledTasks.filter((t) => t.id !== req.params.id);
  saveTasks();
  res.json({ success: true });
});

app.post('/api/scheduled-tasks/:id/cancel', (req, res) => {
  const task = scheduledTasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ success: false, message: 'Task not found.' });

  if (task.status === 'pending') {
    task.status = 'cancelled';
    task.cancelRequested = true;
    saveTasks();
    return res.json({ success: true, task: summarizeTask(task) });
  }

  if (task.status === 'processing') {
    // Scheduler checks this flag between batches and stops the task there.
    task.cancelRequested = true;
    saveTasks();
    return res.json({ success: true, task: summarizeTask(task) });
  }

  res.status(400).json({ success: false, message: `Cannot cancel a task that is already ${task.status}.` });
});

// Flattened, already-resolved rows across all tasks — used by the Scheduled
// Results page. Only rows that have actually run (success or failed) are
// included; still-pending rows of an in-progress task are left out.
app.get('/api/scheduled-results', (_req, res) => {
  const results = [];

  for (const task of scheduledTasks) {
    for (const row of task.rows) {
      if (row.status === 'pending') continue;
      results.push({
        id: `${task.id}:${row.rowNumber}`,
        taskId: task.id,
        taskFileName: task.fileName,
        taskStatus: task.status,
        rowNumber: row.rowNumber,
        campaignUrl: row.campaignUrl,
        campaignName: row.campaignName,
        country: row.country,
        userAgentType: row.userAgentType,
        tagsNotes: row.tagsNotes,
        status: row.status,
        finalUrl: row.finalUrl,
        redirectChain: row.redirectChain,
        errorMessage: row.errorMessage,
        createdAt: task.createdAt,
        generatedAt: row.generatedAt,
      });
    }
  }

  res.json({ success: true, results });
});

function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ---------- Scheduler loop ----------
// Polls for due tasks every SCHEDULE_POLL_INTERVAL_MS and runs their rows in
// small concurrent batches (mirrors the client's own bulk-import batching),
// checking the cancelRequested flag between batches so a cancel takes effect
// promptly instead of only between whole tasks.

const SCHEDULE_BATCH_SIZE = 3;
const SCHEDULE_POLL_INTERVAL_MS = 15000;

let schedulerTickRunning = false;

async function processScheduledTask(task) {
  task.status = 'processing';
  task.startedAt = Date.now();
  saveTasks();

  const pendingRows = task.rows.filter((r) => r.status === 'pending');

  for (let i = 0; i < pendingRows.length; i += SCHEDULE_BATCH_SIZE) {
    if (task.cancelRequested) {
      task.status = 'cancelled';
      saveTasks();
      return;
    }

    const batch = pendingRows.slice(i, i + SCHEDULE_BATCH_SIZE);

    await Promise.allSettled(batch.map(async (row) => {
      try {
        const result = await fetchFinalUrl({
          campaignUrl: row.campaignUrl,
          country: row.country,
          userAgentType: row.userAgentType,
        });
        row.status = 'success';
        row.finalUrl = result.finalUrl;
        row.redirectChain = result.redirectChain || [];
        row.generatedAt = Date.now();
      } catch (err) {
        row.status = 'failed';
        row.errorMessage = err.message;
        row.generatedAt = Date.now();
      }
    }));

    saveTasks();
  }

  task.status = task.cancelRequested ? 'cancelled' : 'completed';
  task.completedAt = Date.now();
  saveTasks();
}

async function schedulerTick() {
  if (schedulerTickRunning) return;
  schedulerTickRunning = true;

  try {
    const now = Date.now();
    const due = scheduledTasks.filter((t) => t.status === 'pending' && t.scheduledAt <= now);

    for (const task of due) {
      // Sequential across tasks (each task already runs its own rows concurrently
      // in batches) to avoid overwhelming the proxy pool with parallel browsers.
      await processScheduledTask(task);
    }
  } catch (err) {
    console.error('Scheduler tick error:', err);
  } finally {
    schedulerTickRunning = false;
  }
}

setInterval(schedulerTick, SCHEDULE_POLL_INTERVAL_MS);
setTimeout(schedulerTick, 3000); // also check shortly after boot

// Ping the URL immediately when the script starts.
// Continue pinging it every 14 minutes.
const url = process.env.PING_URL || '';
async function pingUrl() {
  try {
    const response = await fetch(url);
    console.log(
      `[${new Date().toISOString()}] Status: ${response.status}`
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error: ${error.message}`
    );
  }
}
pingUrl();
setInterval(pingUrl, 14 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});