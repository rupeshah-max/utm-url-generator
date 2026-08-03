const $ = (selector) => document.querySelector(selector);

let results = [];
let filterState = { search: '', country: '', uaType: '', sortBy: 'newest', dateFrom: null, dateTo: null };
let paginationState = { page: 1, pageSize: 10 };
const refreshingIds = new Set();

async function loadResults({ silent } = {}) {
  try {
    const res = await fetch('/api/scheduled-results');
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || 'Request failed.');
    results = data.results;
    renderTable();
  } catch (err) {
    if (!silent) notifyToast('Could not load results', err.message, 'error');
  }
}

function sortResults(list) {
  if (filterState.sortBy === 'importOrder') {
    return [...list].sort((a, b) => {
      if (a.taskFileName === b.taskFileName) return a.rowNumber - b.rowNumber;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }
  return [...list].sort((a, b) => (b.generatedAt || b.createdAt || 0) - (a.generatedAt || a.createdAt || 0));
}

function getFilteredResults() {
  const search = filterState.search.trim().toLowerCase();

  const filtered = results.filter((r) => {
    if (filterState.country && r.country !== filterState.country) return false;
    if (filterState.uaType && r.userAgentType !== filterState.uaType) return false;
    if (!withinDateRange(r.generatedAt || r.createdAt, filterState.dateFrom, filterState.dateTo)) return false;

    if (!search) return true;
    const haystack = [r.campaignUrl, r.campaignName, r.tagsNotes, r.finalUrl, r.country, COUNTRY_LABELS[r.country], r.userAgentType, r.taskFileName]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(search);
  });

  return sortResults(filtered);
}

function getRedirectChain(r) {
  const chain = Array.isArray(r.redirectChain) ? r.redirectChain.filter(Boolean) : [];
  const fallback = [r.campaignUrl, r.finalUrl].filter(Boolean);
  const source = chain.length ? chain : fallback;
  return source.filter((url, index) => index === 0 || url !== source[index - 1]);
}

function createRedirectChainRow(r) {
  const tr = document.createElement('tr');
  tr.className = 'redirect-row';
  tr.hidden = true;
  tr.dataset.chainFor = r.id;

  const chain = getRedirectChain(r);
  tr.innerHTML = `
    <td colspan="9">
      <div class="redirect-chain-panel">
        <div class="redirect-chain-title">Redirect chain</div>
        ${chain.length
          ? `<ol>${chain.map((url) => `<li><a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></li>`).join('')}</ol>`
          : '<p>No redirect chain captured for this row.</p>'}
      </div>
    </td>
  `;
  return tr;
}

function createRow(r, rowNumber) {
  const tr = document.createElement('tr');
  const chain = getRedirectChain(r);
  const isBusy = refreshingIds.has(r.id);

  tr.innerHTML = `
    <td class="row-num-cell">
      <strong>#${rowNumber}</strong>
      <small>${escapeHtml(r.taskFileName)} · row ${r.rowNumber}</small>
    </td>
    <td class="url-cell"><a href="${escapeHtmlAttr(r.campaignUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.campaignUrl)}</a></td>
    <td><span class="flag-chip">${countryLabel(r.country)}</span></td>
    <td>${escapeHtml(r.userAgentType)}</td>
    <td>${escapeHtml(r.campaignName || '')}</td>
    <td>${escapeHtml(r.tagsNotes || '')}</td>
    <td class="final-cell">
      <div class="final-cell-wrap">
        ${r.status === 'success'
          ? `<a href="${escapeHtmlAttr(r.finalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.finalUrl)}</a>
             <button type="button" class="copy-btn" data-url="${escapeHtmlAttr(r.finalUrl)}">Copy</button>`
          : `<span class="status-chip failed">Failed</span>${r.errorMessage ? `<span class="error-inline">${escapeHtml(r.errorMessage)}</span>` : ''}`}
      </div>
    </td>
    <td>${escapeHtml(formatDate(r.generatedAt || r.createdAt))}</td>
    <td class="action-cell">
      <button class="ghost small show-chain" data-id="${r.id}">Show Redirect Chains${chain.length ? ` (${chain.length})` : ''}</button>
      <button class="ghost small refresh" data-id="${r.id}" ${isBusy ? 'disabled' : ''}>${isBusy ? 'Refreshing...' : 'Refresh'}</button>
      <button class="delete" data-id="${r.id}">Delete</button>
    </td>
  `;

  tr.querySelector('.show-chain').addEventListener('click', () => {
    const chainRow = document.querySelector(`tr.redirect-row[data-chain-for="${CSS.escape(r.id)}"]`);
    if (chainRow) chainRow.hidden = !chainRow.hidden;
  });

  tr.querySelector('.refresh').addEventListener('click', () => refreshResultRow(r));
  tr.querySelector('.delete').addEventListener('click', () => deleteResultRow(r));

  const copyBtn = tr.querySelector('.copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', () => copyToClipboard(copyBtn, r.finalUrl));

  return tr;
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
    setTimeout(() => { button.textContent = original; button.classList.remove('copied'); }, 1500);
    notifyToast('Copied', 'Final URL copied to clipboard.', 'success');
  } catch {
    notifyToast('Copy failed', 'Could not copy the final URL.', 'error');
  }
}

function renderTable() {
  const tbody = $('#resultsTable tbody');
  tbody.innerHTML = '';

  const filtered = getFilteredResults();
  const paged = getPagedItems(paginationState, filtered);

  const countEl = $('#resultCount');
  const hasFilters = filterState.search || filterState.country || filterState.uaType || filterState.dateFrom || filterState.dateTo;
  countEl.textContent = hasFilters
    ? `Showing ${paged.items.length ? `${paged.startIndex + 1}-${paged.endIndex}` : '0'} of ${filtered.length} matching results (${results.length} total)`
    : `${results.length} result${results.length === 1 ? '' : 's'} total${results.length ? ` — showing ${paged.startIndex + 1}-${paged.endIndex}` : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">${results.length ? 'No results match your search or filters.' : 'No scheduled results yet.'}</td></tr>`;
    updatePaginationControls(paginationState, filtered.length, paged.totalPages);
    syncBottomPagination(filtered.length, paged.totalPages);
    return;
  }

  const fragment = document.createDocumentFragment();
  paged.items.forEach((r, index) => {
    const rowNumber = paged.startIndex + index + 1;
    fragment.appendChild(createRow(r, rowNumber));
    fragment.appendChild(createRedirectChainRow(r));
  });
  tbody.appendChild(fragment);

  updatePaginationControls(paginationState, filtered.length, paged.totalPages);
  syncBottomPagination(filtered.length, paged.totalPages);
}

function syncBottomPagination(totalRows, totalPages) {
  const indicator = $('#pageIndicator2');
  const prevBtn = $('#prevPageBtn2');
  const nextBtn = $('#nextPageBtn2');
  if (!indicator) return;
  indicator.textContent = totalRows ? `Page ${paginationState.page} of ${totalPages}` : 'Page 1 of 1';
  prevBtn.disabled = paginationState.page <= 1;
  nextBtn.disabled = paginationState.page >= totalPages || totalRows === 0;
}

function getExportRows() {
  return getFilteredResults().map((r, index) => ({
    'Row #': index + 1,
    'Import Row #': r.rowNumber,
    'Source File': r.taskFileName,
    'Campaign URL': r.campaignUrl || '',
    Country: r.country || '',
    'Country Label': COUNTRY_LABELS[r.country] || r.country || '',
    'User Agent Type': r.userAgentType || '',
    'Campaign Name': r.campaignName || '',
    'Tags / Notes': r.tagsNotes || '',
    Status: r.status,
    'Final URL': r.finalUrl || '',
    'Redirect Chain': getRedirectChain(r).join(' -> '),
    Error: r.errorMessage || '',
    'Date Added': formatDate(r.createdAt),
    'Generated At': formatDate(r.generatedAt),
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Scheduled Results');
    XLSX.writeFile(workbook, `nimble_scheduled_results_${stamp}.xlsx`);
    notifyToast('XLSX exported', `${rows.length} filtered rows exported.`, 'success');
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [headers, ...rows.map((row) => headers.map((h) => row[h]))];
  const csv = csvRows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `nimble_scheduled_results_${stamp}.csv`);
  notifyToast('CSV exported', `${rows.length} filtered rows exported.`, 'success');
}

async function refreshResultRow(r) {
  refreshingIds.add(r.id);
  renderTable();
  notifyToast('Refresh started', r.campaignName || r.campaignUrl);

  try {
    const res = await fetch(`/api/scheduled-results/${encodeURIComponent(r.id)}/refresh`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || 'Refresh failed.');

    notifyToast('Refresh complete', 'Final URL regenerated successfully.', 'success');
  } catch (err) {
    notifyToast('Refresh failed', err.message, 'error', 4500);
  } finally {
    refreshingIds.delete(r.id);
    await loadResults();
  }
}

async function deleteResultRow(r) {
  if (!confirm('Remove this row from Scheduled Results? It stays on the source task for record-keeping.')) return;

  try {
    const res = await fetch(`/api/scheduled-results/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || 'Delete failed.');

    notifyToast('Row deleted', 'Removed from Scheduled Results.', 'success');
    await loadResults();
  } catch (err) {
    notifyToast('Delete failed', err.message, 'error');
  }
}

async function clearAllResults() {
  if (!confirm('Clear all scheduled results from this view?')) return;

  try {
    const res = await fetch('/api/scheduled-results', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || 'Clear failed.');

    notifyToast('Results cleared', 'All rows removed from this view.', 'success');
    await loadResults();
  } catch (err) {
    notifyToast('Clear failed', err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadResults();
  setInterval(() => loadResults({ silent: true }), 10000);

  initDateRangeFilter('#dateFrom', '#dateTo', ({ from, to }) => {
    filterState.dateFrom = from;
    filterState.dateTo = to;
    paginationState.page = 1;
    renderTable();
  });

  $('#searchInput').addEventListener('input', debounce((e) => {
    filterState.search = e.target.value;
    paginationState.page = 1;
    renderTable();
  }, 150));

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
  });

  $('#refreshResults').addEventListener('click', () => loadResults());
  $('#clearAll').addEventListener('click', clearAllResults);
  $('#exportCsv').addEventListener('click', () => exportTable('csv'));
  $('#exportXlsx').addEventListener('click', () => exportTable('xlsx'));

  wirePaginationControls({ paginationState, render: renderTable });
  $('#prevPageBtn2').addEventListener('click', () => { paginationState.page -= 1; renderTable(); });
  $('#nextPageBtn2').addEventListener('click', () => { paginationState.page += 1; renderTable(); });
});