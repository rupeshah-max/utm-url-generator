const $ = (selector) => document.querySelector(selector);

let tasks = [];
let filterState = { search: '', status: '', sortBy: 'newest', dateFrom: null, dateTo: null };
let paginationState = { page: 1, pageSize: 10 };
let editingTaskId = null;
let pollTimer = null;

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || 'Request failed.');
  return data;
}

async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || 'Request failed.');
  return data;
}

async function loadTasks({ silent } = {}) {
  try {
    const data = await apiGet('/api/scheduled-tasks');
    tasks = data.tasks;
    renderTable();
  } catch (err) {
    if (!silent) notifyToast('Could not load tasks', err.message, 'error');
  }
}

function sortTasks(list) {
  if (filterState.sortBy === 'scheduledAt') {
    return [...list].sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
  }
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getFilteredTasks() {
  const search = filterState.search.trim().toLowerCase();

  const filtered = tasks.filter((t) => {
    if (filterState.status && t.status !== filterState.status) return false;
    if (!withinDateRange(t.scheduledAt, filterState.dateFrom, filterState.dateTo)) return false;
    if (search && !t.fileName.toLowerCase().includes(search)) return false;
    return true;
  });

  return sortTasks(filtered);
}

function progressCell(task) {
  const pct = task.totalRows ? Math.round((task.completedRows / task.totalRows) * 100) : 0;
  return `
    <div class="progress-wrap">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${task.completedRows}/${task.totalRows} rows (${task.successCount} ok, ${task.failedCount} failed)</div>
    </div>
  `;
}

function actionCell(task) {
  const buttons = [];

  if (task.status === 'pending') {
    buttons.push(`<button class="ghost small edit-btn" data-id="${task.id}">Edit</button>`);
    buttons.push(`<button class="warn small cancel-btn" data-id="${task.id}">Cancel</button>`);
    buttons.push(`<button class="delete delete-btn" data-id="${task.id}">Delete</button>`);
  } else if (task.status === 'processing') {
    buttons.push(`<button class="warn small cancel-btn" data-id="${task.id}">Stop</button>`);
  } else {
    buttons.push(`<button class="delete delete-btn" data-id="${task.id}">Delete</button>`);
  }

  return `<div class="action-cell">${buttons.join('')}</div>`;
}

function createRow(task, rowNumber) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="row-num-cell"><strong>#${rowNumber}</strong></td>
    <td>${escapeHtml(task.fileName)}</td>
    <td><span class="status-chip ${task.status}">${escapeHtml(task.status)}</span></td>
    <td>${progressCell(task)}</td>
    <td>${escapeHtml(formatDate(task.scheduledAt))}</td>
    <td>${escapeHtml(formatDate(task.createdAt))}</td>
    <td>${actionCell(task)}</td>
  `;

  tr.querySelector('.edit-btn')?.addEventListener('click', () => openEditModal(task));
  tr.querySelector('.cancel-btn')?.addEventListener('click', () => cancelTask(task));
  tr.querySelector('.delete-btn')?.addEventListener('click', () => deleteTask(task));

  return tr;
}

function renderTable() {
  const tbody = $('#taskTable tbody');
  tbody.innerHTML = '';

  const filtered = getFilteredTasks();
  const paged = getPagedItems(paginationState, filtered);

  const countEl = $('#resultCount');
  const hasFilters = filterState.search || filterState.status || filterState.dateFrom || filterState.dateTo;
  countEl.textContent = hasFilters
    ? `Showing ${paged.items.length ? `${paged.startIndex + 1}-${paged.endIndex}` : '0'} of ${filtered.length} matching tasks (${tasks.length} total)`
    : `${tasks.length} task${tasks.length === 1 ? '' : 's'} total${tasks.length ? ` — showing ${paged.startIndex + 1}-${paged.endIndex}` : ''}`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${tasks.length ? 'No tasks match your search or filters.' : 'No scheduled tasks yet. Queue a bulk import from the Home page.'}</td></tr>`;
    updatePaginationControls(paginationState, filtered.length, paged.totalPages);
    syncBottomPagination(filtered.length, paged.totalPages);
    return;
  }

  const fragment = document.createDocumentFragment();
  paged.items.forEach((task, index) => fragment.appendChild(createRow(task, paged.startIndex + index + 1)));
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

// ---------- Edit modal ----------

let editPicker = null;

function openEditModal(task) {
  editingTaskId = task.id;
  $('#editFileName').value = task.fileName;
  $('#editModal').style.display = 'block';
  $('#editModalOverlay').style.display = 'block';

  if (!editPicker) {
    editPicker = flatpickr('#editScheduleDateTime', { enableTime: true, dateFormat: 'Y-m-d H:i', minDate: 'today' });
  }
  editPicker.setDate(new Date(task.scheduledAt));
}

function closeEditModal() {
  editingTaskId = null;
  $('#editModal').style.display = 'none';
  $('#editModalOverlay').style.display = 'none';
}

async function saveEdit() {
  if (!editingTaskId) return;
  const fileName = $('#editFileName').value.trim();
  const dtValue = $('#editScheduleDateTime').value.trim();

  if (!fileName || !dtValue) {
    notifyToast('Missing info', 'File name and schedule time are required.', 'error');
    return;
  }

  const ms = new Date(dtValue).getTime();
  if (Number.isNaN(ms)) {
    notifyToast('Invalid date/time', 'Could not parse the scheduled date/time.', 'error');
    return;
  }

  try {
    await apiSend(`/api/scheduled-tasks/${editingTaskId}`, 'PUT', {
      fileName,
      scheduledAt: new Date(ms).toISOString(),
    });
    notifyToast('Task updated', 'Schedule saved.', 'success');
    closeEditModal();
    loadTasks();
  } catch (err) {
    notifyToast('Update failed', err.message, 'error');
  }
}

// ---------- Actions ----------

async function cancelTask(task) {
  if (!confirm(`Cancel "${task.fileName}"? Rows already completed will be kept.`)) return;
  try {
    await apiSend(`/api/scheduled-tasks/${task.id}/cancel`, 'POST');
    notifyToast('Cancel requested', task.status === 'processing' ? 'It will stop after the current batch.' : 'Task cancelled.', 'success');
    loadTasks();
  } catch (err) {
    notifyToast('Cancel failed', err.message, 'error');
  }
}

async function deleteTask(task) {
  if (!confirm(`Delete "${task.fileName}"? This cannot be undone.`)) return;
  try {
    await apiSend(`/api/scheduled-tasks/${task.id}`, 'DELETE');
    notifyToast('Task deleted', '', 'success');
    loadTasks();
  } catch (err) {
    notifyToast('Delete failed', err.message, 'error');
  }
}

// ---------- Wiring ----------

document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  pollTimer = setInterval(() => loadTasks({ silent: true }), 6000);

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

  $('#filterStatus').addEventListener('change', (e) => {
    filterState.status = e.target.value;
    paginationState.page = 1;
    renderTable();
  });

  $('#sortBy').addEventListener('change', (e) => {
    filterState.sortBy = e.target.value;
    paginationState.page = 1;
    renderTable();
  });

  $('#resetFilters').addEventListener('click', () => {
    filterState = { search: '', status: '', sortBy: 'newest', dateFrom: null, dateTo: null };
    paginationState.page = 1;
    $('#searchInput').value = '';
    $('#filterStatus').value = '';
    $('#sortBy').value = 'newest';
    $('#dateFrom')._flatpickr?.clear();
    $('#dateTo')._flatpickr?.clear();
    renderTable();
  });

  $('#refreshTasks').addEventListener('click', () => loadTasks());

  $('#saveEditBtn').addEventListener('click', saveEdit);
  $('#cancelEditBtn').addEventListener('click', closeEditModal);
  $('#editModalOverlay').addEventListener('click', closeEditModal);

  wirePaginationControls({ paginationState, render: renderTable });
  $('#prevPageBtn2').addEventListener('click', () => { paginationState.page -= 1; renderTable(); });
  $('#nextPageBtn2').addEventListener('click', () => { paginationState.page += 1; renderTable(); });
});