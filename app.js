'use strict';

const SUPABASE_URL = 'https://xzjootgfnstlxxdumhsl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4xGqOhRfPpMpyAUbgjuOUQ_QxYwdWo1';
const $ = (selector) => document.querySelector(selector);
const message = $('#message');
const yearInput = $('#year');
const yearTableInput = $('#year-table');
const money = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
let session = null;
let refreshPromise = null;
let loadVersion = 0;
let editingNeighbor = null;
let neighbors = [];
let historyVersion = 0;
let historyReceiptQuery = '';
let historyYearVersion = 0;
let historyYearPayments = null;
let historyOverviewVersion = 0;
let historyOverviewPayments = null;
let historyOverviewLoading = false;

function showMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
  message.hidden = false;
}

function setAuthenticated(authenticated) {
  $('#login-section').hidden = authenticated;
  $('#app').hidden = !authenticated;
  $('#logout').hidden = !authenticated;
  if (!authenticated) {
    loadVersion++;
    showView('dashboard');
    $('#portal-password-form').reset();
    resetNeighborForm();
    $('#neighbors-list').replaceChildren();
    $('#neighbors-empty').hidden = true;
    $('#dues').replaceChildren();
    $('#payments').replaceChildren();
    neighbors = [];
    historyVersion++;
    $('#history-search').value = '';
    $('#history-receipt-search').value = '';
    historyReceiptQuery = '';
    setHistoryReceiptMode(false);
    $('#history-neighbor').replaceChildren(new Option('Selecciona un vecino', ''));
    $('#history-status').textContent = 'Selecciona un vecino para ver sus pagos.';
    historyYearVersion++;
    historyYearPayments = null;
    $('#history-year-search').value = '';
    $('#history-year-neighbor').replaceChildren(new Option('Selecciona un vecino', ''));
    $('#history-year-select').value = String(new Date().getFullYear());
    $('#history-year-status').textContent = 'Selecciona un vecino para ver sus pagos.';
    $('#history-year-months').replaceChildren();
    clearHistoryOverview();
    $('#history-overview-year').value = String(new Date().getFullYear());
    $('#payment-form').elements.vecino.replaceChildren();
    $('#year-info').textContent = '';
    $('#summary-neighbors').textContent = '—';
    $('#summary-paid').textContent = '—';
    $('#summary-debt').textContent = '—';
    $('#summary-info').textContent = '';
  }
}

function clearHistoryOverview() {
  historyOverviewVersion++;
  historyOverviewPayments = null;
  historyOverviewLoading = false;
  $('#history-overview-rows').replaceChildren();
  $('#history-overview-status').textContent = '';
  $('#history-overview-retry').hidden = true;
}

function renderHistoryOverview() {
  const rows = $('#history-overview-rows');
  rows.replaceChildren();
  if (!historyOverviewPayments) return;
  const year = $('#history-overview-year').value;
  const { snapshot, paymentsByNeighbor } = historyOverviewPayments;
  for (const neighbor of snapshot) {
    const months = Array.from({ length: 12 }, () => []);
    for (const payment of paymentsByNeighbor.get(String(neighbor.id))) {
      if (payment.anulado_en) continue;
      for (const application of payment.aplicaciones) {
        if (application.mes.slice(0, 4) === year) {
          months[Number(application.mes.slice(5, 7)) - 1].push(payment);
        }
      }
    }
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = neighbor.nombre;
    if (neighbor.no_paga_cuota) {
      const exempt = document.createElement('small');
      exempt.textContent = 'No paga cuota';
      name.append(exempt);
    }
    row.append(name);
    for (const payments of months) {
      const month = cell(row, '');
      for (const payment of payments) {
        const entry = document.createElement('div');
        entry.className = 'history-overview-entry';
        const receipt = document.createElement('span');
        receipt.textContent = payment.comprobante || 'Sin comprobante';
        const date = document.createElement('small');
        date.textContent = payment.fecha ? payment.fecha.split('-').reverse().join('/') : '';
        entry.append(receipt, date);
        month.append(entry);
      }
    }
    rows.append(row);
  }
  $('#history-overview-status').textContent = snapshot.length
    ? `Pagos aplicados a ${year} para ${snapshot.length} vecinos.`
    : 'No hay vecinos registrados.';
}

async function loadHistoryOverview() {
  const version = ++historyOverviewVersion;
  const activeSession = session;
  if (!activeSession) return;
  historyOverviewPayments = null;
  historyOverviewLoading = true;
  $('#history-overview-rows').replaceChildren();
  $('#history-overview-status').textContent = 'Cargando historial general…';
  $('#history-overview-retry').hidden = true;
  const snapshot = [...neighbors];
  try {
    const payments = await fetchNeighborHistories(snapshot, () => version === historyOverviewVersion && session === activeSession);
    if (version !== historyOverviewVersion || session !== activeSession) return;
    historyOverviewLoading = false;
    historyOverviewPayments = { snapshot, paymentsByNeighbor: payments };
    renderHistoryOverview();
  } catch (error) {
    if (version !== historyOverviewVersion || session !== activeSession) return;
    historyOverviewVersion++;
    historyOverviewLoading = false;
    $('#history-overview-status').textContent = error.code === 'PGRST202'
      ? 'Para habilitar el historial, ejecuta supabase/historial_vecino.sql en Supabase.'
      : `No se pudo cargar el historial general: ${error.message}`;
    $('#history-overview-retry').hidden = false;
  }
}

async function fetchNeighborHistories(snapshot, isCurrent) {
  const payments = new Map();
  let next = 0;
  async function worker() {
    while (next < snapshot.length && isCurrent()) {
      const neighbor = snapshot[next++];
      const data = await rpc('cuotas_historial_vecino', { p_vecino: Number(neighbor.id) });
      payments.set(String(neighbor.id), data);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, snapshot.length) }, worker));
  return payments;
}

function showView(name) {
  for (const view of document.querySelectorAll('.view')) {
    view.hidden = view.id !== `view-${name}`;
  }
  for (const button of document.querySelectorAll('#treasury-menu [data-view]')) {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

async function request(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body)
    });
  } catch {
    throw new Error('No se pudo confirmar la operación. Revisa la conexión y verifica el resultado antes de intentarlo nuevamente.');
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('El servidor devolvió una respuesta inesperada.');
  }
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || data?.error_description || `Error del servidor (${response.status}).`);
    error.code = data?.code;
    throw error;
  }
  return data;
}

function rememberSession(data) {
  if (!data?.access_token || !data?.refresh_token || !data?.expires_in) {
    throw new Error('La respuesta de autenticación no contiene una sesión válida.');
  }
  session = { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + data.expires_in * 1000 };
}

async function accessToken() {
  if (!session) throw new Error('Inicia sesión nuevamente.');
  if (Date.now() < session.expires - 60000) return session.access;
  if (!refreshPromise) {
    const previous = session;
    refreshPromise = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: previous.refresh })
      .then((data) => {
        if (session !== previous) throw new Error('La sesión terminó.');
        rememberSession(data);
        return session.access;
      })
      .catch(() => {
        session = null;
        setAuthenticated(false);
        throw new Error('La sesión venció. Inicia sesión nuevamente.');
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function rpc(name, parameters) {
  return request(`/rest/v1/rpc/${name}`, parameters, await accessToken());
}

function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = value;
  row.append(td);
  return td;
}

function validRut(value) {
  const formatted = value.toUpperCase().replace(/\s/g, '');
  if (!/^(\d{1,8}|\d{1,3}\.\d{3}|\d{1,2}\.\d{3}\.\d{3})-?[\dK]$/.test(formatted)) return false;
  const normalized = formatted.replace(/[.-]/g, '');
  const body = normalized.slice(0, -1);
  if (Number(body) === 0) return false;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (2 + i % 6);
  }
  const digit = (11 - sum % 11) % 11;
  return normalized.at(-1) === (digit === 10 ? 'K' : String(digit));
}

function resetNeighborForm() {
  editingNeighbor = null;
  $('#neighbor-form').reset();
  $('#neighbor-form-title').textContent = 'Agregar vecino';
  $('#neighbor-submit').textContent = 'Guardar vecino';
  $('#neighbor-cancel').hidden = true;
}

function editNeighbor(neighbor) {
  editingNeighbor = { id: neighbor.id, inicio: neighbor.inicio.slice(0, 7), no_paga_cuota: neighbor.no_paga_cuota };
  const form = $('#neighbor-form');
  form.elements.nombre.value = neighbor.nombre;
  form.elements.rut.value = neighbor.rut;
  form.elements.inicio.value = editingNeighbor.inicio;
  form.elements.no_paga_cuota.checked = neighbor.no_paga_cuota;
  $('#neighbor-form-title').textContent = 'Modificar vecino';
  $('#neighbor-submit').textContent = 'Guardar cambios';
  $('#neighbor-cancel').hidden = false;
  message.hidden = true;
  form.elements.nombre.focus();
}

function updateHistoryOptions(preserveSelection = false, prefix = 'history') {
  const select = $(`#${prefix}-neighbor`);
  const selected = preserveSelection ? select.value : '';
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CL');
  const search = normalize($(`#${prefix}-search`).value.trim());
  const matching = neighbors.filter(neighbor => normalize(neighbor.nombre).includes(search) || String(neighbor.id) === selected);
  select.replaceChildren(new Option(matching.length ? 'Selecciona un vecino' : 'No hay vecinos que coincidan', ''));
  for (const neighbor of matching) {
    select.add(new Option(`${neighbor.nombre} · ${neighbor.rut}`, String(neighbor.id)));
  }
  select.value = matching.some(neighbor => String(neighbor.id) === selected) ? selected : '';
}

function renderHistoryYear() {
  const container = $('#history-year-months');
  container.replaceChildren();
  if (!historyYearPayments) return;
  const year = $('#history-year-select').value;
  let total = 0;
  let matches = 0;
  for (const payment of historyYearPayments) {
    const entries = payment.aplicaciones.filter(item => item.mes.slice(0, 4) === year)
      .sort((a, b) => a.mes.localeCompare(b.mes));
    if (!entries.length) continue;
    const applied = entries.reduce((sum, item) => sum + Number(item.monto), 0);
    if (!payment.anulado_en) total += applied;
    matches++;
    const ranges = [];
    for (const entry of entries) {
      const month = Number(entry.mes.slice(5, 7)) - 1;
      const amount = Number(entry.monto);
      const previous = ranges.at(-1);
      if (previous && previous.end + 1 === month && previous.amount === amount) {
        previous.end = month;
      } else {
        ranges.push({ start: month, end: month, amount });
      }
    }
    const months = ranges.map(range => {
      const name = range.start === range.end ? monthNames[range.start] : `${monthNames[range.start]}–${monthNames[range.end]}`;
      return `${name}: ${money.format(range.amount)}${range.start === range.end ? '' : ' por mes'}`;
    }).join('; ');
    const row = document.createElement('tr');
    const date = payment.fecha ? payment.fecha.split('-').reverse().join('/') : '';
    cell(row, date).dataset.label = 'Fecha';
    cell(row, payment.comprobante || '—').dataset.label = 'Comprobante';
    cell(row, months).dataset.label = 'Meses y monto por mes';
    cell(row, money.format(applied)).dataset.label = 'Aplicado en el año';
    const state = cell(row, payment.anulado_en ? `Anulado: ${payment.motivo_anulacion}` : 'Registrado');
    state.dataset.label = 'Estado';
    if (payment.anulado_en) state.className = 'history-year-cancelled';
    container.append(row);
  }
  const neighbor = neighbors.find(item => String(item.id) === $('#history-year-neighbor').value);
  $('#history-year-status').textContent = matches
    ? `Pagos de ${neighbor.nombre} aplicados a ${year}: ${money.format(total)} vigentes.`
    : `No hay pagos aplicados a ${year} para ${neighbor.nombre}. Un mes sin pagos no implica necesariamente deuda.`;
}

async function loadHistoryYear() {
  const selected = $('#history-year-neighbor').value;
  const version = ++historyYearVersion;
  const activeSession = session;
  historyYearPayments = null;
  $('#history-year-months').replaceChildren();
  if (!selected || !activeSession) {
    $('#history-year-status').textContent = 'Selecciona un vecino para ver sus pagos.';
    return;
  }
  $('#history-year-status').textContent = 'Cargando pagos…';
  try {
    const data = await rpc('cuotas_historial_vecino', { p_vecino: Number(selected) });
    if (version !== historyYearVersion || session !== activeSession) return;
    historyYearPayments = data;
    renderHistoryYear();
  } catch (error) {
    if (version !== historyYearVersion || session !== activeSession) return;
    $('#history-year-status').textContent = error.code === 'PGRST202'
      ? 'Para habilitar el historial, ejecuta supabase/historial_vecino.sql en Supabase.'
      : `No se pudo cargar el historial: ${error.message}`;
  }
}

function setHistoryReceiptMode(enabled) {
  $('#history-neighbor-column').hidden = !enabled;
  document.querySelector('.history-table').classList.toggle('search-results', enabled);
}

function appendHistoryPayment(payment, neighbor) {
  const row = document.createElement('tr');
  if (neighbor) {
    const neighborCell = cell(row, neighbor.nombre);
    neighborCell.dataset.label = 'Vecino';
    neighborCell.className = 'history-neighbor-cell';
  }
  const date = payment.fecha ? payment.fecha.split('-').reverse().join('/') : '';
  cell(row, date).dataset.label = 'Fecha';
  cell(row, payment.comprobante || '—').dataset.label = 'N.º comprobante';
  const months = cell(row, '');
  months.dataset.label = 'Cuota mes y año';
  months.className = 'history-months-cell';
  const list = document.createElement('div');
  list.className = 'history-months';
  for (const item of payment.aplicaciones) {
    const month = document.createElement('span');
    month.className = 'history-month';
    const name = document.createElement('span');
    name.textContent = `${monthNames[Number(item.mes.slice(5, 7)) - 1].toUpperCase()}-${item.mes.slice(0, 4)}`;
    const amount = document.createElement('small');
    amount.textContent = money.format(item.monto);
    month.append(name, amount);
    list.append(month);
  }
  if (!payment.aplicaciones.length) list.textContent = 'Sin cuotas aplicadas';
  months.append(list);
  cell(row, money.format(payment.monto)).dataset.label = 'Monto total';
  cell(row, payment.anulado_en ? `Anulado: ${payment.motivo_anulacion}` : 'Registrado').dataset.label = 'Estado';
  const action = cell(row, '');
  if (!payment.anulado_en) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'danger';
    button.textContent = 'Anular';
    button.addEventListener('click', () => cancelPayment(payment.id, button));
    action.append(button);
  }
  $('#payments').append(row);
}

async function loadHistoryReceipt() {
  const query = historyReceiptQuery;
  const version = ++historyVersion;
  const activeSession = session;
  const snapshot = [...neighbors];
  $('#payments').replaceChildren();
  setHistoryReceiptMode(true);
  if (!query || !activeSession) {
    $('#history-status').textContent = 'Escribe un comprobante para buscar.';
    return;
  }
  $('#history-status').textContent = 'Buscando comprobante en todos los vecinos…';
  try {
    const histories = await fetchNeighborHistories(snapshot, () => version === historyVersion && session === activeSession);
    if (version !== historyVersion || session !== activeSession) return;
    let matches = 0;
    const normalizedQuery = query.toUpperCase();
    for (const neighbor of snapshot) {
      for (const payment of histories.get(String(neighbor.id))) {
        if (payment.comprobante && payment.comprobante.toUpperCase().includes(normalizedQuery)) {
          appendHistoryPayment(payment, neighbor);
          matches++;
        }
      }
    }
    $('#history-status').textContent = matches
      ? `${matches} ${matches === 1 ? 'pago encontrado' : 'pagos encontrados'} para el comprobante «${query}».`
      : `No se encontraron pagos para el comprobante «${query}».`;
  } catch (error) {
    if (version !== historyVersion || session !== activeSession) return;
    historyVersion++;
    $('#payments').replaceChildren();
    $('#history-status').textContent = error.code === 'PGRST202'
      ? 'Para habilitar el historial, ejecuta supabase/historial_vecino.sql en Supabase.'
      : `No se pudo buscar el comprobante: ${error.message}`;
  }
}

async function loadHistory() {
  const selected = $('#history-neighbor').value;
  const version = ++historyVersion;
  const activeSession = session;
  $('#payments').replaceChildren();
  setHistoryReceiptMode(false);
  if (!selected || !activeSession) {
    $('#history-status').textContent = 'Selecciona un vecino para ver sus pagos.';
    return;
  }
  $('#history-status').textContent = 'Cargando pagos…';
  try {
    const data = await rpc('cuotas_historial_vecino', { p_vecino: Number(selected) });
    if (version !== historyVersion || session !== activeSession) return;
    const neighbor = neighbors.find(item => String(item.id) === selected);
    for (const payment of data) appendHistoryPayment(payment);
    $('#history-status').textContent = data.length ? `Pagos de ${neighbor.nombre}.` : `No hay pagos registrados para ${neighbor.nombre}.`;
  } catch (error) {
    if (version !== historyVersion || session !== activeSession) return;
    $('#payments').replaceChildren();
    $('#history-status').textContent = error.code === 'PGRST202'
      ? 'Para habilitar el historial, ejecuta supabase/historial_vecino.sql en Supabase.'
      : `No se pudo cargar el historial: ${error.message}`;
  }
}

function render(data) {
  const select = $('#payment-form').elements.vecino;
  const selected = select.value;
  const historySelected = $('#history-neighbor').value;
  const historyYearSelected = $('#history-year-neighbor').value;
  select.replaceChildren(new Option('Selecciona un vecino', ''));
  neighbors = data.vecinos;
  const neighborsList = $('#neighbors-list');
  neighborsList.replaceChildren();
  $('#neighbors-empty').hidden = data.vecinos.length > 0;
  for (const neighbor of data.vecinos) {
    if (!neighbor.no_paga_cuota) select.add(new Option(`${neighbor.nombre} · ${neighbor.rut}`, neighbor.id));
    const row = document.createElement('tr');
    cell(row, neighbor.nombre);
    cell(row, neighbor.rut);
    cell(row, `${monthNames[Number(neighbor.inicio.slice(5, 7)) - 1]} ${neighbor.inicio.slice(0, 4)}`);
    cell(row, neighbor.no_paga_cuota ? 'No paga cuota' : 'Paga cuota');
    const action = cell(row, '');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline';
    button.textContent = '✎ Modificar';
    button.setAttribute('aria-label', `Modificar a ${neighbor.nombre}`);
    button.addEventListener('click', () => editNeighbor(neighbor));
    action.append(button);
    neighborsList.append(row);
  }
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
  updateHistoryOptions(true);
  if (historySelected && !$('#history-neighbor').value) loadHistory();
  updateHistoryOptions(true, 'history-year');
  if (historyYearSelected && !$('#history-year-neighbor').value) loadHistoryYear();

  const dues = $('#dues');
  dues.replaceChildren();
  let total = 0;
  const paidTotal = data.pagos.reduce((sum, payment) => payment.anulado_en ? sum : sum +
    payment.aplicaciones.filter(item => Number(item.mes.slice(0, 4)) === Number(yearInput.value))
      .reduce((subtotal, item) => subtotal + Number(item.monto), 0), 0);
  let unconfigured = false;
  for (const due of data.cuotas) {
    const neighbor = data.vecinos.find(item => item.id === due.vecino_id);
    const row = document.createElement('tr');
    const balance = due.monto === null ? null : Math.max(due.monto - due.pagado, 0);
    if (balance !== null) total += balance;
    else unconfigured = true;
    cell(row, neighbor.nombre);
    cell(row, neighbor.rut);
    cell(row, monthNames[Number(due.mes.slice(5, 7)) - 1]);
    cell(row, due.monto === null ? 'Sin configurar' : money.format(due.monto));
    cell(row, money.format(due.pagado));
    cell(row, balance === null ? '—' : money.format(balance));
    cell(row, neighbor.no_paga_cuota ? 'Exento' : balance === null ? 'Sin configurar' : balance === 0 ? 'Pagada' : due.pagado > 0 ? 'Parcial' : 'Pendiente');
    dues.append(row);
  }
  const fee = data.aranceles.find(item => item.anio === Number(yearInput.value));
  $('#summary-neighbors').textContent = String(data.vecinos.length);
  $('#summary-paid').textContent = money.format(paidTotal);
  $('#summary-debt').textContent = money.format(total);
  $('#summary-info').textContent = unconfigured
    ? `Resumen de ${yearInput.value}. Hay cuotas sin monto configurado; la deuda mostrada no las incluye.`
    : `Resumen de ${yearInput.value}. Los montos pagados corresponden a cuotas aplicadas a ese año.`;
  yearTableInput.value = yearInput.value;
  $('#year-info').textContent = fee
    ? `Cuota mensual: ${money.format(fee.monto)}. Saldo del año completo (incluye meses futuros): ${money.format(total)}.`
    : 'No se ha configurado la cuota mensual para este año.';

}

async function load() {
  if (!yearInput.reportValidity()) return;
  const version = ++loadVersion;
  const data = await rpc('cuotas_datos', { p_anio: Number(yearInput.value) });
  if (version === loadVersion && session) render(data);
}

async function withBusy(form, operation) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message.hidden = true;
  try {
    await operation();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function updateAfterSave(text) {
  historyVersion++;
  if (historyReceiptQuery) {
    $('#payments').replaceChildren();
    $('#history-status').textContent = 'Actualizando resultados…';
  }
  clearHistoryOverview();
  try {
    await load();
    clearHistoryOverview();
    if (historyReceiptQuery) await loadHistoryReceipt();
    else if ($('#history-neighbor').value) await loadHistory();
    if ($('#history-year-neighbor').value) await loadHistoryYear();
    if (!$('#view-history-overview').hidden) await loadHistoryOverview();
    showMessage(text);
  } catch (error) {
    if (historyReceiptQuery) $('#history-status').textContent = `No se pudo actualizar la búsqueda: ${error.message}`;
    showMessage(`${text} No se pudo actualizar la pantalla: ${error.message}`, true);
  }
}

$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  withBusy(form, async () => {
    const credentials = { email: form.elements.email.value.trim(), password: form.elements.password.value };
    const data = await request('/auth/v1/token?grant_type=password', credentials);
    rememberSession(data);
    form.elements.password.value = '';
    try {
      await load();
    } catch (error) {
      session = null;
      setAuthenticated(false);
      throw error;
    }
    setAuthenticated(true);
    showView('dashboard');
    showMessage('Sesión iniciada.');
  });
});

$('#treasury-menu').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) {
    showView(button.dataset.view);
    if (button.dataset.view === 'history-overview' && !historyOverviewPayments && !historyOverviewLoading) loadHistoryOverview();
  }
});

$('#history-search').addEventListener('input', () => {
  historyReceiptQuery = '';
  $('#history-receipt-search').value = '';
  updateHistoryOptions();
  loadHistory();
});
$('#history-neighbor').addEventListener('change', () => {
  historyReceiptQuery = '';
  $('#history-receipt-search').value = '';
  loadHistory();
});
$('#history-receipt-search').addEventListener('input', () => {
  historyReceiptQuery = '';
  historyVersion++;
  $('#history-neighbor').value = '';
  $('#payments').replaceChildren();
  setHistoryReceiptMode(true);
  $('#history-status').textContent = 'Escribe un comprobante y pulsa Buscar comprobante.';
});
$('#history-receipt-form').addEventListener('submit', event => {
  event.preventDefault();
  historyReceiptQuery = $('#history-receipt-search').value.trim();
  $('#history-search').value = '';
  updateHistoryOptions();
  loadHistoryReceipt();
});
$('#history-year-search').addEventListener('input', () => {
  updateHistoryOptions(false, 'history-year');
  loadHistoryYear();
});
$('#history-year-neighbor').addEventListener('change', () => {
  loadHistoryYear();
});
$('#history-year-select').addEventListener('change', renderHistoryYear);
$('#history-overview-year').addEventListener('change', renderHistoryOverview);
$('#history-overview-retry').addEventListener('click', loadHistoryOverview);

$('#logout').addEventListener('click', async () => {
  const previous = session;
  session = null;
  setAuthenticated(false);
  message.hidden = true;
  if (!previous) return;
  try {
    await request('/auth/v1/logout', {}, previous.access);
    showMessage('Sesión cerrada.');
  } catch (error) {
    showMessage(`La sesión se cerró en esta página, pero no se pudo cerrar en el servidor: ${error.message}`, true);
  }
});

$('#neighbor-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validRut(form.elements.rut.value)) {
    showMessage('Ingresa un RUT válido con su dígito verificador.', true);
    form.elements.rut.focus();
    return;
  }
  const neighbor = editingNeighbor;
  if (neighbor && form.elements.inicio.value !== neighbor.inicio
    && !confirm('Cambiar el mes de inicio puede modificar la deuda. Los pagos existentes no se reasignarán. ¿Continuar?')) return;
  if (neighbor && form.elements.no_paga_cuota.checked !== neighbor.no_paga_cuota
    && !confirm('Cambiar esta opción afecta todas las cuotas, también las anteriores. Los pagos registrados se conservan. ¿Continuar?')) return;
  withBusy(form, async () => {
    const parameters = {
      p_nombre: form.elements.nombre.value.trim(), p_rut: form.elements.rut.value.trim(),
      p_inicio: `${form.elements.inicio.value}-01`,
      p_no_paga_cuota: form.elements.no_paga_cuota.checked
    };
    const name = neighbor ? 'cuotas_editar_vecino' : 'cuotas_crear_vecino';
    const args = neighbor ? { p_vecino: neighbor.id, ...parameters } : parameters;
    try {
      await rpc(name, args);
    } catch (error) {
      if (error.code !== 'PGRST202') throw error;
      if (parameters.p_no_paga_cuota || neighbor?.no_paga_cuota !== undefined) {
        throw new Error('Para habilitar esta opción, ejecuta supabase/exencion_cuotas.sql en Supabase.');
      }
      const { p_no_paga_cuota, ...legacyArgs } = args;
      await rpc(name, legacyArgs);
    }
    resetNeighborForm();
    await updateAfterSave(neighbor ? 'Datos del vecino modificados.' : 'Vecino agregado.');
  });
});

$('#neighbor-cancel').addEventListener('click', () => {
  resetNeighborForm();
  message.hidden = true;
  $('#neighbor-form').elements.nombre.focus();
});

$('#export-neighbors').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  message.hidden = true;
  try {
    if (!yearInput.reportValidity()) return;
    const version = loadVersion;
    const data = await rpc('cuotas_datos', { p_anio: Number(yearInput.value) });
    if (!session || version !== loadVersion) throw new Error('La sesión o los datos cambiaron. Vuelve a intentar la descarga.');
    const buffer = await ExportarVecinos.crearArchivo(data.vecinos);
    if (!session || version !== loadVersion) throw new Error('La sesión o los datos cambiaron. Vuelve a intentar la descarga.');
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vecinos.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showMessage(`No se pudo descargar el Excel: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

$('#fee-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  withBusy(form, async () => {
    await rpc('cuotas_guardar_arancel', { p_anio: Number(form.elements.anio.value), p_monto: Number(form.elements.monto.value) });
    yearInput.value = form.elements.anio.value;
    yearTableInput.value = yearInput.value;
    await updateAfterSave('Monto anual guardado.');
  });
});

$('#portal-password-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  withBusy(form, async () => {
    const password = form.elements.password.value;
    if (password !== form.elements.confirmation.value) {
      throw new Error('Las claves no coinciden.');
    }
    if (new TextEncoder().encode(password).length > 72) {
      throw new Error('La clave es demasiado larga. Usa un máximo de 72 bytes.');
    }
    await rpc('cuotas_cambiar_clave_portal', { p_clave: password });
    form.reset();
    showMessage('Clave común cambiada. Comunícala a los vecinos.');
  });
});

$('#payment-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  withBusy(form, async () => {
    await rpc('cuotas_registrar_pago', {
      p_vecino: Number(form.elements.vecino.value), p_monto: Number(form.elements.monto.value),
      p_fecha: form.elements.fecha.value, p_comprobante: form.elements.comprobante.value
    });
    form.elements.monto.value = '';
    form.elements.comprobante.value = '';
    await updateAfterSave('Pago registrado.');
  });
});

async function cancelPayment(id, button) {
  const reason = prompt('Indica el motivo de la anulación:');
  if (reason === null) return;
  if (!reason.trim()) { showMessage('Debes indicar un motivo de anulación.', true); return; }
  button.disabled = true;
  try {
    await rpc('cuotas_anular_pago', { p_pago: id, p_motivo: reason });
    await updateAfterSave('Pago anulado.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function changeYear(value) {
  yearInput.value = value;
  yearTableInput.value = value;
  load().catch(error => showMessage(error.message, true));
}

yearInput.addEventListener('change', () => changeYear(yearInput.value));
yearTableInput.addEventListener('change', () => changeYear(yearTableInput.value));
const today = new Date();
for (let year = 2100; year >= 2000; year--) {
  $('#history-year-select').add(new Option(String(year), String(year)));
  $('#history-overview-year').add(new Option(String(year), String(year)));
}
$('#history-year-select').value = String(today.getFullYear());
$('#history-overview-year').value = String(today.getFullYear());
yearInput.value = today.getFullYear();
yearTableInput.value = today.getFullYear();
$('#fee-form').elements.anio.value = today.getFullYear();
$('#payment-form').elements.fecha.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
