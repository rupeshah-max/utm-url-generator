// Relies on shared helpers loaded from js/common.js (escapeHtml, COUNTRY_LABELS,
// formatDate, newId, debounce, toast fns, downloadBlob, date-range + pagination helpers).

const STORAGE_KEY = 'nimble_way_campaigns_v1';

const $ = (selector) => document.querySelector(selector);

const COUNTRY_ALIASES = {
  US: 'US', UNITEDSTATES: 'US', USA: 'US',
  GB: 'GB', UNITEDKINGDOM: 'GB', UK: 'GB',
  IN: 'IN', INDIA: 'IN',
  DE: 'DE', GERMANY: 'DE',
  FR: 'FR', FRANCE: 'FR',
  CA: 'CA', CANADA: 'CA',
  AU: 'AU', AUSTRALIA: 'AU',
  JP: 'JP', JAPAN: 'JP',
  BR: 'BR', BRAZIL: 'BR',
  RU: 'RU', RUSSIA: 'RU',
  BY: 'BY', BELARUS: 'BY',
  HU: 'HU', HUNGARY: 'HU',
  SK: 'SK', SLOVAKIA: 'SK',
};

const UA_ALIASES = {
  RANDOM: 'random',
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
};

const VALID_UA_TYPES = new Set(['random', 'desktop', 'mobile', 'tablet']);

// How many rows to send to the proxy service concurrently during bulk import.
const BULK_BATCH_SIZE = 3;

// Persisted so an in-progress bulk import can resume after a reload or a
// connection drop, picking up exactly where it left off.
const IMPORT_STATE_KEY = 'nimble_import_state_v1';

let filterState = {
  search: '',
  country: '',
  uaType: '',
  sortBy: 'newest',
  dateFrom: null,
  dateTo: null,
};

let paginationState = {
  page: 1,
  pageSize: 10,
};

let importRunning = false;
let importMode = 'runNow'; // 'runNow' | 'schedule'
let pendingScheduleRows = null; // parsed rows waiting on a schedule datetime + confirm click
let pendingScheduleFileName = '';

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getCampaigns() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? safeJsonParse(raw, []) : [];
}

function setCampaigns(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function getCampaignStatus(campaign) {
  if (campaign.status) return campaign.status;
  return campaign.finalUrl ? 'success' : 'failed';
}

function buildCampaignRecord(data, overrides = {}) {
  const now = Date.now();
  return {
    id: newId(),
    campaignUrl: data.campaignUrl,
    campaignName: data.campaignName || '',
    tagsNotes: data.tagsNotes || '',
    country: data.country,
    userAgentType: data.userAgentType || 'random',
    finalUrl: data.finalUrl || '',
    redirectChain: Array.isArray(data.redirectChain) ? data.redirectChain : [],
    status: data.status || (data.finalUrl ? 'success' : 'failed'),
    errorMessage: data.errorMessage || '',
    createdAt: data.createdAt || now,
    generatedAt: data.generatedAt || (data.finalUrl ? now : null),
    ...overrides,
  };
}

// ---------- Filtering ----------

function sortCampaigns(list) {
  if (filterState.sortBy === 'importOrder') {
    return [...list].sort((a, b) => {
      const aHas = typeof a.importRowNumber === 'number';
      const bHas = typeof b.importRowNumber === 'number';

      if (aHas && bHas) {
        if (a.importFileName === b.importFileName) {
          return a.importRowNumber - b.importRowNumber;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      }

      if (aHas) return -1;
      if (bHas) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getFilteredCampaigns() {
  const campaigns = getCampaigns();
  const search = filterState.search.trim().toLowerCase();

  const filtered = campaigns.filter((c) => {
    if (filterState.country && c.country !== filterState.country) return false;
    if (filterState.uaType && c.userAgentType !== filterState.uaType) return false;
    if (!withinDateRange(c.createdAt, filterState.dateFrom, filterState.dateTo)) return false;

    if (!search) return true;

    const haystack = [
      c.campaignUrl,
      c.campaignName,
      c.tagsNotes,
      c.finalUrl,
      c.country,
      COUNTRY_LABELS[c.country],
      c.userAgentType,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(search);
  });

  return sortCampaigns(filtered);
}

// ---------- Table rendering ----------

function getRedirectChain(campaign) {
  const chain = Array.isArray(campaign.redirectChain) ? campaign.redirectChain.filter(Boolean) : [];
  const fallback = [campaign.campaignUrl, campaign.finalUrl].filter(Boolean);
  const source = chain.length ? chain : fallback;

  return source.filter((url, index) => index === 0 || url !== source[index - 1]);
}

function createRedirectChainRow(campaign) {
  const tr = document.createElement('tr');
  tr.className = 'redirect-row';
  tr.hidden = true;
  tr.dataset.chainFor = campaign.id;

  const chain = getRedirectChain(campaign);

  tr.innerHTML = `
    <td colspan="9">
      <div class="redirect-chain-panel">
        <div class="redirect-chain-title">Redirect chain</div>
        ${
          chain.length
            ? `<ol>${chain.map((url) => `
                <li>
                  <a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">
                    ${escapeHtml(url)}
                  </a>
                </li>
              `).join('')}</ol>`
            : '<p>No redirect chain captured for this row yet.</p>'
        }
      </div>
    </td>
  `;

  return tr;
}

function createRow(campaign, rowNumber) {
  const tr = document.createElement('tr');
  const status = getCampaignStatus(campaign);
  const isBusy = status === 'refreshing';
  const chain = getRedirectChain(campaign);

  tr.innerHTML = `
    <td class="row-num-cell">
      <strong>#${rowNumber}</strong>
      ${typeof campaign.importRowNumber === 'number' ? `<small>Import row ${campaign.importRowNumber}</small>` : ''}
    </td>

    <td class="url-cell">
      <a href="${escapeHtmlAttr(campaign.campaignUrl)}"
         target="_blank"
         rel="noopener noreferrer">
        ${escapeHtml(campaign.campaignUrl)}
      </a>
    </td>

    <td><span class="flag-chip">${countryLabel(campaign.country)}</span></td>

    <td>${escapeHtml(campaign.userAgentType)}</td>

    <td>${escapeHtml(campaign.campaignName || '')}</td>

    <td>${escapeHtml(campaign.tagsNotes || '')}</td>

    <td class="final-cell">
      <div class="final-cell-wrap">
        ${
          campaign.finalUrl
            ? `<a href="${escapeHtmlAttr(campaign.finalUrl)}"
                 target="_blank"
                 rel="noopener noreferrer">
                 ${escapeHtml(campaign.finalUrl)}
               </a>
               <button type="button" class="copy-btn" data-url="${escapeHtmlAttr(campaign.finalUrl)}">
                 Copy
               </button>`
            : `<span class="status-chip failed">Failed</span>
               ${campaign.errorMessage ? `<span class="error-inline">${escapeHtml(campaign.errorMessage)}</span>` : ''}`
        }
      </div>
    </td>
    <td>${escapeHtml(formatDate(campaign.createdAt))}</td>
    <td class="action-cell">
      <button class="ghost small show-chain" data-id="${campaign.id}">
        Show Redirect Chains${chain.length ? ` (${chain.length})` : ''}
      </button>
      <button class="ghost small refresh" data-id="${campaign.id}" ${isBusy ? 'disabled' : ''}>
        ${isBusy ? 'Refreshing...' : 'Refresh'}
      </button>
      <button class="delete" data-id="${campaign.id}">
        Delete
      </button>
    </td>
  `;

  tr.querySelector('.delete').addEventListener('click', () => {
    const campaigns = getCampaigns().filter((x) => x.id !== campaign.id);
    setCampaigns(campaigns);
    renderTable();
    notifyToast('Campaign deleted', 'The row was removed from the table.');
  });

  tr.querySelector('.show-chain').addEventListener('click', () => toggleRedirectChain(campaign.id));
  tr.querySelector('.refresh').addEventListener('click', () => refreshCampaign(campaign.id));

  const copyBtn = tr.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyToClipboard(copyBtn, campaign.finalUrl));
  }

  return tr;
}

function toggleRedirectChain(id) {
  const chainRow = document.querySelector(`tr.redirect-row[data-chain-for="${CSS.escape(id)}"]`);
  if (!chainRow) return;
  chainRow.hidden = !chainRow.hidden;
}

async function copyToClipboard(button, text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    const original = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('copied');

    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1500);
    notifyToast('Copied', 'Final URL copied to clipboard.', 'success');
  } catch {
    button.textContent = 'Failed';
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1500);
    notifyToast('Copy failed', 'Could not copy the final URL.', 'error');
  }
}

function renderTable() {
  const tbody = $('#campaignTable tbody');
  tbody.innerHTML = '';

  const all = getCampaigns();
  const filtered = getFilteredCampaigns();
  const paged = getPagedItems(paginationState, filtered);

  const countEl = $('#resultCount');
  if (countEl) {
    const hasFilters = filterState.search || filterState.country || filterState.uaType || filterState.dateFrom || filterState.dateTo;
    countEl.textContent = hasFilters
      ? `Showing ${paged.items.length ? `${paged.startIndex + 1}-${paged.endIndex}` : '0'} of ${filtered.length} matching campaigns (${all.length} total)`
      : `${all.length} campaign${all.length === 1 ? '' : 's'} total${all.length ? ` — showing ${paged.startIndex + 1}-${paged.endIndex}` : ''}`;
  }

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty">
          ${all.length ? 'No campaigns match your search or filters.' : 'No campaigns yet.'}
        </td>
      </tr>
    `;
    updatePaginationControls(paginationState, filtered.length, paged.totalPages);
    syncBottomPagination(paginationState, filtered.length, paged.totalPages);
    return;
  }

  const fragment = document.createDocumentFragment();
  paged.items.forEach((campaign, index) => {
    const rowNumber = paged.startIndex + index + 1;
    fragment.appendChild(createRow(campaign, rowNumber));
    fragment.appendChild(createRedirectChainRow(campaign));
  });
  tbody.appendChild(fragment);

  updatePaginationControls(paginationState, filtered.length, paged.totalPages);
  syncBottomPagination(paginationState, filtered.length, paged.totalPages);
}

// The bottom pagination strip mirrors the top one under different element ids.
function syncBottomPagination(state, totalRows, totalPages) {
  const indicator = $('#pageIndicator2');
  const prevBtn = $('#prevPageBtn2');
  const nextBtn = $('#nextPageBtn2');
  if (!indicator || !prevBtn || !nextBtn) return;

  indicator.textContent = totalRows ? `Page ${state.page} of ${totalPages}` : 'Page 1 of 1';
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= totalPages || totalRows === 0;
}

function setResultHtml(html) {
  $('#result').innerHTML = html;
}

function setImportResultHtml(html) {
  $('#importResult').innerHTML = html;
}

// ---------- Import-state persistence (resume after reload / connection drop) ----------

function saveImportState(state) {
  try {
    localStorage.setItem(IMPORT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — the import still runs, it just can't resume after a reload.
  }
}

function loadImportState() {
  try {
    const raw = localStorage.getItem(IMPORT_STATE_KEY);
    return raw ? safeJsonParse(raw, null) : null;
  } catch {
    return null;
  }
}

function clearImportState() {
  localStorage.removeItem(IMPORT_STATE_KEY);
}

function showResumeBanner(state) {
  const el = $('#resumeBanner');
  if (!el) return;

  el.hidden = false;
  el.innerHTML = `
    <span>
      Unfinished import found: <strong>${escapeHtml(state.fileName)}</strong> —
      ${state.pendingRows.length} of ${state.totalRows} rows remaining.
    </span>
    <button type="button" id="resumeImportBtn" class="ghost small">Resume Import</button>
    <button type="button" id="discardImportBtn" class="ghost small">Discard</button>
  `;

  $('#resumeImportBtn').addEventListener('click', () => {
    el.hidden = true;
    state.paused = false;
    saveImportState(state);
    runImportQueue(state);
  });

  $('#discardImportBtn').addEventListener('click', () => {
    clearImportState();
    el.hidden = true;
  });
}

function hideResumeBanner() {
  const el = $('#resumeBanner');
  if (el) el.hidden = true;
}

// Distinguishes "the internet dropped mid-request" from a normal application
// error (bad country, invalid URL, proxy misconfigured, etc.) — only the
// former should pause-and-resume the import rather than counting as a failed row.
function isNetworkError(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  const msg = (err.message || '').toLowerCase();
  return (
    err instanceof TypeError &&
    (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed'))
  );
}

// ---------- API ----------

async function fetchFinalUrl(payload) {
  const response = await fetch('/api/fetch-final-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Unable to fetch final URL.');
  }

  return data;
}

async function createScheduledTask(payload) {
  const response = await fetch('/api/scheduled-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Unable to schedule the import.');
  }
  return data;
}

// ---------- CSV / XLSX bulk import ----------

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z]/g, '');
}

const FIELD_ALIASES = {
  campaignUrl: ['campaignurl', 'url', 'link', 'destinationurl', 'targeturl'],
  campaignName: ['campaignname', 'name'],
  country: ['country', 'countrycode', 'geo', 'countryname'],
  userAgentType: ['uatype', 'useragenttype', 'useragent', 'device', 'devicetype'],
  tagsNotes: ['tagsnotes', 'tags', 'notes', 'tagnotes'],
};

function getField(row, fieldName) {
  const aliases = FIELD_ALIASES[fieldName];
  const rowKeys = Object.keys(row);

  for (const alias of aliases) {
    const match = rowKeys.find((k) => normalizeKey(k) === alias);
    if (match !== undefined && String(row[match]).trim() !== '') {
      return String(row[match]).trim();
    }
  }

  return '';
}

function resolveCountry(rawValue) {
  const key = normalizeKey(rawValue);
  return COUNTRY_ALIASES[key.toUpperCase()] || COUNTRY_ALIASES[key] || null;
}

function resolveUaType(rawValue) {
  const key = normalizeKey(rawValue).toUpperCase();
  return UA_ALIASES[key] || (VALID_UA_TYPES.has(rawValue?.toLowerCase()) ? rawValue.toLowerCase() : null);
}

function parseWorkbookToRows(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function validateRow(rawRow, rowNumber) {
  const campaignUrl = getField(rawRow, 'campaignUrl');
  const campaignName = getField(rawRow, 'campaignName');
  const countryRaw = getField(rawRow, 'country');
  const uaRaw = getField(rawRow, 'userAgentType') || 'random';
  const tagsNotes = getField(rawRow, 'tagsNotes');

  const errors = [];

  if (!campaignUrl) errors.push('missing Campaign URL');
  if (!campaignName) errors.push('missing Campaign Name');

  const country = countryRaw ? resolveCountry(countryRaw) : null;
  if (!countryRaw) errors.push('missing Country');
  else if (!country) errors.push(`unrecognized Country "${countryRaw}"`);

  const userAgentType = resolveUaType(uaRaw);
  if (!userAgentType) errors.push(`unrecognized UA Type "${uaRaw}"`);

  if (errors.length) {
    return { valid: false, rowNumber, reason: errors.join(', ') };
  }

  return {
    valid: true,
    data: { rowNumber, campaignUrl, campaignName, country, userAgentType, tagsNotes },
  };
}

async function parseBulkFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const rawRows = parseWorkbookToRows(workbook);

  if (!rawRows.length) throw new Error('The file has no data rows.');

  const valid = [];
  const invalid = [];

  rawRows.forEach((row, idx) => {
    const rowNumber = idx + 2; // account for header row
    const result = validateRow(row, rowNumber);
    if (result.valid) valid.push(result.data);
    else invalid.push({ rowNumber, reason: result.reason });
  });

  return { valid, invalid };
}

async function handleBulkFile(file) {
  if (importMode === 'schedule') {
    // Just parse + stage the file; the actual scheduling happens when the
    // user picks a date/time and clicks "Queue Selected File".
    setImportResultHtml(`<div class="status">Reading ${escapeHtml(file.name)}...</div>`);
    try {
      const { valid, invalid } = await parseBulkFile(file);
      if (!valid.length) {
        setImportResultHtml('<div class="error">No valid rows found. Required columns: Campaign URL, Campaign Name, Country, UA Type.</div>');
        return;
      }
      pendingScheduleRows = valid;
      pendingScheduleFileName = file.name;
      $('#scheduleFileLabel').textContent = `${valid.length} valid rows ready from ${file.name}${invalid.length ? ` (${invalid.length} skipped)` : ''}.`;
      setImportResultHtml('<div class="status">File parsed. Pick a date/time above, then click "Queue Selected File".</div>');
      notifyToast('File ready', `${valid.length} rows parsed from ${file.name}.`);
    } catch (err) {
      setImportResultHtml(`<div class="error">❌ Could not read file: ${escapeHtml(err.message)}</div>`);
    }
    return;
  }

  const fileInput = $('#bulkFile');
  fileInput.disabled = true;

  setImportResultHtml(`<div class="status">Reading ${escapeHtml(file.name)}...</div>`);
  notifyToast('Reading import file', file.name);

  try {
    const { valid, invalid } = await parseBulkFile(file);

    if (!valid.length) {
      setImportResultHtml(`
        <div class="error">No valid rows found. Required columns: Campaign URL, Campaign Name, Country, UA Type.</div>
      `);
      notifyToast('Import stopped', 'No valid rows found in the file.', 'error');
      return;
    }

    const state = {
      importId: newId(),
      fileName: file.name,
      totalRows: valid.length,
      batchSize: BULK_BATCH_SIZE,
      pendingRows: valid,
      paused: false,
      resultsSoFar: { successCount: 0, failed: [...invalid] },
      createdAt: Date.now(),
    };

    saveImportState(state);
    notifyToast('Import started', `${valid.length} valid rows queued from ${file.name}.`);
    await runImportQueue(state);

  } catch (err) {
    setImportResultHtml(`<div class="error">❌ Could not read file: ${escapeHtml(err.message)}</div>`);
    notifyToast('Import failed', err.message, 'error');
  } finally {
    fileInput.disabled = false;
    fileInput.value = '';
  }
}

async function queueScheduledImport() {
  if (!pendingScheduleRows || !pendingScheduleRows.length) {
    notifyToast('No file staged', 'Choose a CSV/Excel file first.', 'error');
    return;
  }

  const dtValue = $('#scheduleDateTime').value.trim();
  if (!dtValue) {
    notifyToast('Pick a date & time', 'Choose when this import should run.', 'error');
    return;
  }

  const scheduledAtMs = new Date(dtValue).getTime();
  if (Number.isNaN(scheduledAtMs)) {
    notifyToast('Invalid date/time', 'Could not parse the scheduled date/time.', 'error');
    return;
  }

  const btn = $('#confirmScheduleBtn');
  btn.disabled = true;
  btn.textContent = 'Queuing...';

  try {
    await createScheduledTask({
      fileName: pendingScheduleFileName,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      rows: pendingScheduleRows,
    });

    notifyToast('Import scheduled', `${pendingScheduleRows.length} rows queued for ${new Date(scheduledAtMs).toLocaleString()}.`, 'success');
    setImportResultHtml(`<div class="success">✅ Scheduled ${pendingScheduleRows.length} rows. See the Scheduled Tasks page for progress.</div>`);

    pendingScheduleRows = null;
    pendingScheduleFileName = '';
    $('#scheduleFileLabel').textContent = '';
    $('#bulkFile').value = '';
  } catch (err) {
    notifyToast('Scheduling failed', err.message, 'error', 4500);
    setImportResultHtml(`<div class="error">❌ ${escapeHtml(err.message)}</div>`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Queue Selected File';
  }
}

// Processes state.pendingRows in fixed-size concurrent batches. Designed to be
// safely re-entrant: it can be called fresh, or called again later with a state
// object loaded from localStorage to resume exactly where it left off, since
// pendingRows only ever shrinks once a row is actually confirmed done.
async function runImportQueue(state) {
  importRunning = true;
  hideResumeBanner();
  $('#bulkFile').disabled = true;

  const totalBatches = Math.ceil(state.totalRows / state.batchSize);

  while (state.pendingRows.length > 0) {
    if (!navigator.onLine) {
      pauseImportForOffline(state);
      return;
    }

    const batch = state.pendingRows.slice(0, state.batchSize);
    const doneBefore = state.totalRows - state.pendingRows.length;
    const batchIndex = Math.floor(doneBefore / state.batchSize);
    const batchRowNumbers = batch.map((r) => r.rowNumber);

    let doneInBatch = 0;

    const renderToastBody = () => `
      <div class="toast-title">Importing campaigns</div>
      <div class="toast-body">
        ${escapeHtml(state.fileName)} — batch ${batchIndex + 1} of ${totalBatches}
        (rows ${Math.min(...batchRowNumbers)}–${Math.max(...batchRowNumbers)} of ${state.totalRows})
      </div>
      <div class="toast-sub">
        Processing: ${batch.map((r) => escapeHtml(r.campaignName)).join(', ')} — ${doneInBatch}/${batch.length} done
      </div>
    `;

    showToast(renderToastBody());
    setImportResultHtml(`
      <div class="status">Batch ${batchIndex + 1} of ${totalBatches} in progress — ${doneBefore} of ${state.totalRows} rows done so far.</div>
    `);

    const results = await Promise.allSettled(
      batch.map(async (row) => {
        try {
          const res = await fetchFinalUrl({
            campaignUrl: row.campaignUrl,
            campaignName: row.campaignName,
            tagsNotes: row.tagsNotes,
            country: row.country,
            userAgentType: row.userAgentType,
            importId: state.importId,
            rowNumber: row.rowNumber,
            totalRows: state.totalRows,
            batchIndex,
            totalBatches,
            batchRowNumbers,
          });
          doneInBatch += 1;
          updateToast(renderToastBody());
          return { finalUrl: res.finalUrl, redirectChain: res.redirectChain || [] };
        } catch (err) {
          doneInBatch += 1;
          updateToast(renderToastBody());
          throw err;
        }
      })
    );

    const connectivityDropped =
      !navigator.onLine || results.some((r) => r.status === 'rejected' && isNetworkError(r.reason));

    if (connectivityDropped) {
      pauseImportForOffline(state);
      return;
    }

    const campaigns = getCampaigns();

    results.forEach((result, i) => {
      const row = batch[i];

      if (result.status === 'fulfilled') {
        campaigns.unshift(buildCampaignRecord({
          campaignUrl: row.campaignUrl,
          campaignName: row.campaignName,
          tagsNotes: row.tagsNotes,
          country: row.country,
          userAgentType: row.userAgentType,
          finalUrl: result.value.finalUrl,
          redirectChain: result.value.redirectChain,
          status: 'success',
        }, {
          importId: state.importId,
          importFileName: state.fileName,
          importRowNumber: row.rowNumber,
        }));
        state.resultsSoFar.successCount += 1;
      } else {
        const message = result.reason.message || 'Unable to fetch final URL.';
        campaigns.unshift(buildCampaignRecord({
          campaignUrl: row.campaignUrl,
          campaignName: row.campaignName,
          tagsNotes: row.tagsNotes,
          country: row.country,
          userAgentType: row.userAgentType,
          status: 'failed',
          errorMessage: message,
        }, {
          importId: state.importId,
          importFileName: state.fileName,
          importRowNumber: row.rowNumber,
        }));
        state.resultsSoFar.failed.push({
          rowNumber: row.rowNumber,
          reason: `"${row.campaignName}" — ${message}`,
        });
      }
    });

    setCampaigns(campaigns);
    renderTable();

    state.pendingRows = state.pendingRows.slice(batch.length);
    saveImportState(state);
  }

  importRunning = false;
  $('#bulkFile').disabled = false;
  clearImportState();

  updateToast(`
    <div class="toast-title">Import complete</div>
    <div class="toast-body">${state.resultsSoFar.successCount} of ${state.totalRows} rows imported successfully.</div>
  `);
  hideToast(4000);

  const errorList = state.resultsSoFar.failed
    .slice(0, 10)
    .map((f) => `<li>Row ${f.rowNumber ?? '—'}: ${escapeHtml(f.reason)}</li>`)
    .join('');

  setImportResultHtml(`
    <div class="import-summary">
      <strong>${state.resultsSoFar.successCount}</strong> of <strong>${state.totalRows}</strong> rows imported successfully.
      ${state.resultsSoFar.failed.length ? `<strong>${state.resultsSoFar.failed.length}</strong> failed.` : ''}
    </div>
    ${errorList ? `<ul class="import-errors">${errorList}${state.resultsSoFar.failed.length > 10 ? '<li>...and more</li>' : ''}</ul>` : ''}
  `);
}

function pauseImportForOffline(state) {
  importRunning = false;
  state.paused = true;
  saveImportState(state);

  const doneSoFar = state.totalRows - state.pendingRows.length;

  updateToast(`
    <div class="toast-title">⚠️ Connection lost</div>
    <div class="toast-body">
      Import paused at row ${doneSoFar + 1} of ${state.totalRows}.
    </div>
    <div class="toast-sub">It'll resume automatically once you're back online.</div>
  `);

  setImportResultHtml(`
    <div class="error">⚠️ Internet connection lost. Import paused (${doneSoFar} of ${state.totalRows} rows done) — it'll resume automatically once you're back online.</div>
  `);

  $('#bulkFile').disabled = false;
}

function onBackOnline() {
  if (importRunning) return;

  const state = loadImportState();
  if (!state || !state.pendingRows || !state.pendingRows.length) return;

  state.paused = false;
  saveImportState(state);

  updateToast(`
    <div class="toast-title">Back online</div>
    <div class="toast-body">Resuming import — ${state.pendingRows.length} of ${state.totalRows} rows left...</div>
  `);

  runImportQueue(state);
}

function downloadSampleTemplate() {
  const rows = [
    ['Campaign URL', 'Campaign Name', 'Country', 'UA Type', 'Tags Notes'],
    ['https://example.com/summer-sale', 'Summer Sale', 'US', 'random', 'summer, promo'],
    ['https://example.com/launch', 'Product Launch', 'United Kingdom', 'mobile', 'launch'],
    ['https://example.com/holiday', 'Holiday Deals', 'IN', 'desktop', ''],
  ];

  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'nimble_campaign_template.csv');
  notifyToast('Template downloaded', 'Sample CSV template is ready.', 'success');
}

async function refreshCampaign(id) {
  const campaigns = getCampaigns();
  const index = campaigns.findIndex((campaign) => campaign.id === id);
  if (index === -1) return;

  const campaign = campaigns[index];

  campaigns[index] = { ...campaign, status: 'refreshing', errorMessage: '' };
  setCampaigns(campaigns);
  renderTable();
  notifyToast('Refresh started', campaign.campaignName || campaign.campaignUrl);

  try {
    const res = await fetchFinalUrl({
      campaignUrl: campaign.campaignUrl,
      campaignName: campaign.campaignName,
      tagsNotes: campaign.tagsNotes,
      country: campaign.country,
      userAgentType: campaign.userAgentType,
    });

    const latest = getCampaigns();
    const latestIndex = latest.findIndex((item) => item.id === id);
    if (latestIndex === -1) return;

    latest[latestIndex] = {
      ...latest[latestIndex],
      finalUrl: res.finalUrl,
      redirectChain: res.redirectChain || [],
      status: 'success',
      errorMessage: '',
      generatedAt: Date.now(),
    };
    setCampaigns(latest);
    notifyToast('Refresh complete', 'Final URL regenerated successfully.', 'success');
  } catch (err) {
    const latest = getCampaigns();
    const latestIndex = latest.findIndex((item) => item.id === id);
    if (latestIndex !== -1) {
      latest[latestIndex] = { ...latest[latestIndex], status: 'failed', errorMessage: err.message };
      setCampaigns(latest);
    }
    notifyToast('Refresh failed', err.message, 'error', 4500);
  } finally {
    renderTable();
  }
}

function getExportRows() {
  return getFilteredCampaigns().map((campaign, index) => ({
    'Row #': index + 1,
    'Import Row #': typeof campaign.importRowNumber === 'number' ? campaign.importRowNumber : '',
    'Campaign URL': campaign.campaignUrl || '',
    Country: campaign.country || '',
    'Country Label': COUNTRY_LABELS[campaign.country] || campaign.country || '',
    'User Agent Type': campaign.userAgentType || '',
    'Campaign Name': campaign.campaignName || '',
    'Tags / Notes': campaign.tagsNotes || '',
    Status: getCampaignStatus(campaign),
    'Final URL': campaign.finalUrl || '',
    'Redirect Chain': getRedirectChain(campaign).join(' -> '),
    Error: campaign.errorMessage || '',
    'Import File': campaign.importFileName || '',
    'Date Added': formatDate(campaign.createdAt),
    'Generated At': campaign.generatedAt ? formatDate(campaign.generatedAt) : '',
  }));
}

function exportTable(format) {
  const rows = getExportRows();

  if (!rows.length) {
    notifyToast('Nothing to export', 'No rows match the current filters.', 'error');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Campaigns');
    XLSX.writeFile(workbook, `nimble_campaigns_${stamp}.xlsx`);
    notifyToast('XLSX exported', `${rows.length} filtered rows exported.`, 'success');
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [headers, ...rows.map((row) => headers.map((header) => row[header]))];
  const csv = csvRows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');

  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `nimble_campaigns_${stamp}.csv`);
  notifyToast('CSV exported', `${rows.length} filtered rows exported.`, 'success');
}

// ---------- Mode toggle wiring ----------

function setImportMode(mode) {
  importMode = mode;
  $('#modeRunNow').classList.toggle('active', mode === 'runNow');
  $('#modeSchedule').classList.toggle('active', mode === 'schedule');
  $('#scheduleFields').hidden = mode !== 'schedule';

  if (mode === 'runNow') {
    pendingScheduleRows = null;
    pendingScheduleFileName = '';
    $('#scheduleFileLabel').textContent = '';
  }
}

// ---------- Wiring ----------

document.addEventListener('DOMContentLoaded', () => {
  renderTable();

  const savedImportState = loadImportState();
  if (savedImportState && savedImportState.pendingRows && savedImportState.pendingRows.length) {
    showResumeBanner(savedImportState);
  }

  window.addEventListener('online', onBackOnline);

  flatpickr('#scheduleDateTime', { enableTime: true, dateFormat: 'Y-m-d H:i', minDate: 'today' });
  initDateRangeFilter('#dateFrom', '#dateTo', ({ from, to }) => {
    filterState.dateFrom = from;
    filterState.dateTo = to;
    paginationState.page = 1;
    renderTable();
  });

  $('#modeRunNow').addEventListener('click', () => setImportMode('runNow'));
  $('#modeSchedule').addEventListener('click', () => setImportMode('schedule'));
  $('#confirmScheduleBtn').addEventListener('click', queueScheduledImport);

  $('#clearAll').addEventListener('click', () => {
    if (!confirm('Clear all saved campaigns?')) return;
    localStorage.removeItem(STORAGE_KEY);
    renderTable();
    setResultHtml('');
    notifyToast('Table cleared', 'All saved campaigns were removed.');
  });

  const onSearchInput = debounce((value) => {
    filterState.search = value;
    paginationState.page = 1;
    renderTable();
  }, 150);

  $('#searchInput').addEventListener('input', (e) => onSearchInput(e.target.value));

  $('#filterCountry').addEventListener('change', (e) => {
    filterState.country = e.target.value;
    paginationState.page = 1;
    renderTable();
  });

  $('#filterUaType').addEventListener('change', (e) => {
    filterState.uaType = e.target.value;
    paginationState.page = 1;
    renderTable();
  });

  $('#sortBy').addEventListener('change', (e) => {
    filterState.sortBy = e.target.value;
    paginationState.page = 1;
    renderTable();
    notifyToast('Sort changed', e.target.options[e.target.selectedIndex].text);
  });

  $('#resetFilters').addEventListener('click', () => {
    filterState = { search: '', country: '', uaType: '', sortBy: 'newest', dateFrom: null, dateTo: null };
    paginationState.page = 1;
    $('#searchInput').value = '';
    $('#filterCountry').value = '';
    $('#filterUaType').value = '';
    $('#sortBy').value = 'newest';
    $('#dateFrom')._flatpickr?.clear();
    $('#dateTo')._flatpickr?.clear();
    renderTable();
    notifyToast('Filters reset', 'Showing the default newest-first table.');
  });

  $('#downloadTemplate').addEventListener('click', downloadSampleTemplate);
  $('#exportCsv').addEventListener('click', () => exportTable('csv'));
  $('#exportXlsx').addEventListener('click', () => exportTable('xlsx'));

  wirePaginationControls({ paginationState, render: renderTable });
  $('#prevPageBtn2')?.addEventListener('click', () => { paginationState.page -= 1; renderTable(); });
  $('#nextPageBtn2')?.addEventListener('click', () => { paginationState.page += 1; renderTable(); });

  $('#bulkFile').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleBulkFile(file);
  });

  $('#campaignForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = $('#submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Fetching...';

    const campaignUrl = $('#campaignUrl').value.trim();
    const campaignName = $('#campaignName').value.trim();
    const tagsNotes = $('#tagsNotes').value.trim();
    const country = $('#country').value;
    const userAgentType = $('#userAgentType').value;

    const payload = { campaignUrl, campaignName, tagsNotes, country, userAgentType };

    setResultHtml(`<div class="status">Fetching final URL using <strong>${escapeHtml(country)}</strong> proxy...</div>`);
    notifyToast('Generating final URL', `${country} proxy with ${userAgentType} user agent.`);

    try {
      const { finalUrl, redirectChain } = await fetchFinalUrl(payload);

      const campaigns = getCampaigns();
      campaigns.unshift(buildCampaignRecord({
        campaignUrl, campaignName, tagsNotes, country, userAgentType,
        finalUrl, redirectChain, status: 'success',
      }));
      setCampaigns(campaigns);
      renderTable();

      setResultHtml(`
        <div class="success">✅ Final URL Generated Successfully</div>
        <div class="final-url">
          <a href="${escapeHtmlAttr(finalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(finalUrl)}</a>
        </div>
      `);

      $('#campaignName').value = '';
      $('#tagsNotes').value = '';
      notifyToast('Final URL generated', 'Campaign saved to the table.', 'success');
    } catch (err) {
      const campaigns = getCampaigns();
      campaigns.unshift(buildCampaignRecord({
        campaignUrl, campaignName, tagsNotes, country, userAgentType,
        status: 'failed', errorMessage: err.message,
      }));
      setCampaigns(campaigns);
      renderTable();

      setResultHtml(`<div class="error">❌ ${escapeHtml(err.message)}</div>`);
      notifyToast('Generation failed', 'Saved as a failed row so you can refresh it.', 'error', 4500);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Campaign';
    }
  });
});
