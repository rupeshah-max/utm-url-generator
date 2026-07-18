// Shared utilities used by app.js, scheduled-tasks.js, scheduled-results.js

const COUNTRY_LABELS = {
  US: '🇺🇸 United States',
  GB: '🇬🇧 United Kingdom',
  IN: '🇮🇳 India',
  DE: '🇩🇪 Germany',
  FR: '🇫🇷 France',
  CA: '🇨🇦 Canada',
  AU: '🇦🇺 Australia',
  JP: '🇯🇵 Japan',
  BR: '🇧🇷 Brazil',
  RU: '🇷🇺 Russia',
  BY: '🇧🇾 Belarus',
  HU: '🇭🇺 Hungary',
  SK: '🇸🇰 Slovakia',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeHtmlAttr(str) {
  return escapeHtml(str);
}

function countryLabel(code) {
  return COUNTRY_LABELS[code] || escapeHtml(code);
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---------- Toasts (shared) ----------

function notifyToast(title, body = '', variant = 'info', delay = 3000) {
  const container = document.querySelector('#toastContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${variant}`;
  el.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-fade');
    setTimeout(() => el.remove(), 300);
  }, delay);
}

let _activeToastEl = null;

function showToast(html) {
  const container = document.querySelector('#toastContainer');
  if (!container) return null;
  _activeToastEl = document.createElement('div');
  _activeToastEl.className = 'toast';
  _activeToastEl.innerHTML = html;
  container.appendChild(_activeToastEl);
  return _activeToastEl;
}

function updateToast(html) {
  if (_activeToastEl) {
    _activeToastEl.innerHTML = html;
  } else {
    showToast(html);
  }
}

function hideToast(delay = 2500) {
  if (!_activeToastEl) return;
  const el = _activeToastEl;
  _activeToastEl = null;
  setTimeout(() => {
    el.classList.add('toast-fade');
    setTimeout(() => el.remove(), 300);
  }, delay);
}

// ---------- Date-range filter (flatpickr) ----------
// Wires a "from" and "to" text input to flatpickr range-aware pickers and calls
// onChange({from, to}) (ISO date strings or null) whenever the range changes.
function initDateRangeFilter(fromSelector, toSelector, onChange) {
  const fromEl = document.querySelector(fromSelector);
  const toEl = document.querySelector(toSelector);
  if (!fromEl || !toEl || typeof flatpickr === 'undefined') return null;

  let fromDate = null;
  let toDate = null;

  const fromPicker = flatpickr(fromEl, {
    dateFormat: 'Y-m-d',
    onChange: (dates) => {
      fromDate = dates[0] ? dates[0] : null;
      toPicker.set('minDate', fromDate || undefined);
      onChange({ from: fromDate ? fromDate.toISOString().slice(0, 10) : null, to: toDate ? toDate.toISOString().slice(0, 10) : null });
    },
  });

  const toPicker = flatpickr(toEl, {
    dateFormat: 'Y-m-d',
    onChange: (dates) => {
      toDate = dates[0] ? dates[0] : null;
      fromPicker.set('maxDate', toDate || undefined);
      onChange({ from: fromDate ? fromDate.toISOString().slice(0, 10) : null, to: toDate ? toDate.toISOString().slice(0, 10) : null });
    },
  });

  return {
    clear() {
      fromPicker.clear();
      toPicker.clear();
      fromDate = null;
      toDate = null;
    },
  };
}

// Returns true if timestamp (ms) falls within [from, to] inclusive date strings (Y-m-d).
function withinDateRange(timestamp, from, to) {
  if (!timestamp) return !from && !to;
  if (!from && !to) return true;

  const d = new Date(timestamp);
  const dayStr = d.toISOString().slice(0, 10);

  if (from && dayStr < from) return false;
  if (to && dayStr > to) return false;
  return true;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Generic pagination controls wiring ----------
// Wires prev/next buttons + a page-size select (with custom + all options) to a
// paginationState object and calls render() whenever it changes.
function wirePaginationControls({ paginationState, render, prefix = '' }) {
  const pageSizeEl = document.querySelector(`#${prefix}pageSize`);
  const customEl = document.querySelector(`#${prefix}customPageSize`);
  const prevBtn = document.querySelector(`#${prefix}prevPageBtn`);
  const nextBtn = document.querySelector(`#${prefix}nextPageBtn`);

  if (pageSizeEl) {
    pageSizeEl.addEventListener('change', (e) => {
      const value = e.target.value;
      if (customEl) customEl.hidden = value !== 'custom';

      if (value === 'custom') {
        const customValue = Number.parseInt(customEl.value, 10);
        paginationState.pageSize = Number.isFinite(customValue) && customValue > 0 ? customValue : 10;
        if (customEl) customEl.focus();
      } else {
        paginationState.pageSize = value === 'all' ? 'all' : Number.parseInt(value, 10);
      }
      paginationState.page = 1;
      render();
    });
  }

  if (customEl) {
    customEl.addEventListener('input', debounce((e) => {
      const parsed = Number.parseInt(e.target.value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) return;
      paginationState.pageSize = Math.min(parsed, 1000);
      paginationState.page = 1;
      render();
    }, 150));
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      paginationState.page -= 1;
      render();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      paginationState.page += 1;
      render();
    });
  }
}

function getPageSize(paginationState, totalRows) {
  if (paginationState.pageSize === 'all') return Math.max(totalRows, 1);
  const parsed = Number.parseInt(paginationState.pageSize, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function getPagedItems(paginationState, filtered) {
  const pageSize = getPageSize(paginationState, filtered.length);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  paginationState.page = Math.min(Math.max(1, paginationState.page), totalPages);

  if (paginationState.pageSize === 'all') {
    return { items: filtered, totalPages, pageSize, startIndex: 0, endIndex: filtered.length };
  }

  const startIndex = (paginationState.page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  return { items: filtered.slice(startIndex, endIndex), totalPages, pageSize, startIndex, endIndex };
}

function updatePaginationControls(paginationState, totalRows, totalPages, prefix = '') {
  const indicator = document.querySelector(`#${prefix}pageIndicator`);
  const prevBtn = document.querySelector(`#${prefix}prevPageBtn`);
  const nextBtn = document.querySelector(`#${prefix}nextPageBtn`);
  if (!indicator || !prevBtn || !nextBtn) return;

  indicator.textContent = totalRows ? `Page ${paginationState.page} of ${totalPages}` : 'Page 1 of 1';
  prevBtn.disabled = paginationState.page <= 1;
  nextBtn.disabled = paginationState.page >= totalPages || totalRows === 0;
}