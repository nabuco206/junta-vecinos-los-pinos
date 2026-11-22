'use strict';

const SUPABASE_URL = 'https://xzjootgfnstlxxdumhsl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4xGqOhRfPpMpyAUbgjuOUQ_QxYwdWo1';
const $ = (selector) => document.querySelector(selector);
const message = $('#message');
const yearInput = $('#year');
const money = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
let session = null;
let refreshPromise = null;
let loadVersion = 0;
let editingNeighbor = null;
let neighbors = [];
let neighborSort = { key: 'nombre', direction: 'asc' };
let historyVersion = 0;
let historyReceiptQuery = '';
let historyYearVersion = 0;
let historyYearPayments = null;
let historyOverviewVersion = 0;
let historyOverviewPayments = null;
let historyOverviewLoading = false;
let historyOverviewExporting = false;
let receiptsVersion = 0;
let receipts = null;
let receiptSort = { key: 'comprobante', direction: 'asc' };
let receiptsExporting = false;
let editingReceiptDate = null;
let savingReceiptDate = false;
let paymentEditVersion = 0;
let paymentEditQuery = '';
let editingPayment = null;
let paymentCalculationVersion = 0;
let paymentCalculationTimer = null;
let paymentAutomatic = null;
let paymentCalculationPending = false;
let paymentCalculationFailed = false;
const overviewFirstYear = 2014;
const overviewLastYear = 2027;

function defaultOverviewYear() {
  return String(Math.min(overviewLastYear, Math.max(overviewFirstYear, new Date().getFullYear())));
}

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
    clearReceipts();
    $('#history-overview-year').value = defaultOverviewYear();
    $('#payment-form').elements.vecino.replaceChildren();
    paymentEditVersion++;
    paymentEditQuery = '';
    $('#payment-edit-search').value = '';
    $('#payment-edit-search-status').textContent = '';
    $('#payment-edit-results').replaceChildren();
    resetPaymentEdit();
    $('#current-fee').textContent = '';
    $('#fee-list').replaceChildren();
    $('#fee-list-table').hidden = true;
    $('#fee-list-status').textContent = '';
    $('#export-cuotas-status').textContent = '';
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
  updateOverviewExportButton();
  $('#history-overview-rows').replaceChildren();
  $('#history-overview-status').textContent = '';
  $('#history-overview-total').textContent = '';
  $('#history-overview-retry').hidden = true;
}

function overviewRows(year) {
  const { snapshot, paymentsByNeighbor } = historyOverviewPayments;
  return snapshot.map(neighbor => {
    const months = Array.from({ length: 12 }, () => []);
    let total = 0;
    for (const payment of paymentsByNeighbor.get(String(neighbor.id))) {
      if (payment.anulado_en) continue;
      for (const application of payment.aplicaciones) {
        if (application.mes.slice(0, 4) === year) {
          months[Number(application.mes.slice(5, 7)) - 1].push(payment);
          total += Number(application.monto);
        }
      }
    }
    return { neighbor, months, total };
  });
}

function updateOverviewExportButton() {
  $('#export-history-overview').disabled = !historyOverviewPayments || historyOverviewExporting;
}

function renderHistoryOverview() {
  const rows = $('#history-overview-rows');
  rows.replaceChildren();
  if (!historyOverviewPayments) return;
  const year = $('#history-overview-year').value;
  const overview = overviewRows(year);
  for (const { neighbor, months } of overview) {
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
  const count = historyOverviewPayments.snapshot.length;
  $('#history-overview-status').textContent = count
    ? `Pagos aplicados a ${year} para ${count} vecinos.`
    : 'No hay vecinos registrados.';
  const total = overview.reduce((sum, item) => sum + item.total, 0);
  $('#history-overview-total').textContent = `Monto recaudado aplicado a cuotas de ${year}: ${money.format(total)}.`;
  updateOverviewExportButton();
}

async function loadHistoryOverview() {
  const version = ++historyOverviewVersion;
  const activeSession = session;
  if (!activeSession) return;
  historyOverviewPayments = null;
  historyOverviewLoading = true;
  updateOverviewExportButton();
  $('#history-overview-rows').replaceChildren();
  $('#history-overview-total').textContent = '';
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

function clearReceipts() {
  receiptsVersion++;
  receipts = null;
  $('#receipts-list').replaceChildren();
  $('#receipts-status').textContent = '';
  $('#export-receipts').disabled = true;
  $('#receipts-duplicates').disabled = true;
  const dialog = $('#receipts-duplicates-dialog');
  if (dialog.open) dialog.close();
  const dateDialog = $('#receipt-date-dialog');
  if (dateDialog.open) dateDialog.close();
  editingReceiptDate = null;
  $('#receipts-duplicates-list').replaceChildren();
  $('#receipts-duplicates-status').textContent = '';
}

async function loadReceipts() {
  const activeSession = session;
  if (!activeSession) return;
  clearReceipts();
  const version = receiptsVersion;
  $('#receipts-status').textContent = 'Cargando comprobantes…';
  const snapshot = [...neighbors];
  try {
    const histories = await fetchNeighborHistories(snapshot, () => version === receiptsVersion && session === activeSession);
    if (version !== receiptsVersion || session !== activeSession) return;
    const rows = [];
    for (const neighbor of snapshot) {
      for (const payment of histories.get(String(neighbor.id))) {
        if (!payment.comprobante || !payment.comprobante.trim()) continue;
        rows.push({
          comprobante: payment.comprobante, vecino: neighbor.nombre, vecinoId: String(neighbor.id),
          fecha: payment.fecha ? payment.fecha.split('-').reverse().join('/') : '',
          monto: Number(payment.monto), estado: payment.anulado_en ? 'Anulado' : 'Registrado',
          pago: payment
        });
      }
    }
    receipts = rows;
    renderReceipts();
    $('#receipts-status').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'pago con comprobante' : 'pagos con comprobante'}.` : 'No hay comprobantes registrados.';
    $('#export-receipts').disabled = !rows.length || receiptsExporting;
    $('#receipts-duplicates').disabled = false;
  } catch (error) {
    if (version !== receiptsVersion || session !== activeSession) return;
    $('#receipts-status').textContent = error.code === 'PGRST202'
      ? 'Para habilitar el historial, ejecuta supabase/historial_vecino.sql en Supabase.'
      : `No se pudieron cargar los comprobantes: ${error.message}`;
  }
}

function sortReceiptRows(items, key, direction) {
  const collator = new Intl.Collator('es-CL', { numeric: true, sensitivity: 'base' });
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    if (key === 'fecha') {
      const left = a.pago.fecha;
      const right = b.pago.fecha;
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      return collator.compare(left, right) * multiplier;
    }
    if (key === 'monto') return (a.monto - b.monto) * multiplier;
    return collator.compare(a[key], b[key]) * multiplier;
  });
}

function renderReceipts() {
  if (!receipts) return;
  receipts = sortReceiptRows(receipts, receiptSort.key, receiptSort.direction);
  const list = $('#receipts-list');
  list.replaceChildren();
  for (const item of receipts) {
    const row = document.createElement('tr');
    for (const value of [item.comprobante, item.vecino, item.fecha, money.format(item.monto), item.estado]) cell(row, value);
    const action = cell(row, '');
    if (!item.pago.anulado_en) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline';
      button.textContent = item.pago.fecha ? 'Modificar fecha' : 'Ingresar fecha';
      button.setAttribute('aria-label', `${button.textContent} del comprobante ${item.comprobante} de ${item.vecino}, pago ${item.pago.id}`);
      button.addEventListener('click', () => openReceiptDate(item));
      action.append(button);
    }
    list.append(row);
  }
  for (const header of document.querySelectorAll('#receipts-sort-headers th[aria-sort]')) {
    const button = header.querySelector('[data-receipt-sort]');
    const active = button.dataset.receiptSort === receiptSort.key;
    header.setAttribute('aria-sort', active ? (receiptSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  }
}

function sortReceiptsBy(key) {
  if (receiptSort.key === key) receiptSort.direction = receiptSort.direction === 'asc' ? 'desc' : 'asc';
  else receiptSort = { key, direction: 'asc' };
  renderReceipts();
}

function openReceiptDate(item) {
  if (!session || savingReceiptDate) return;
  editingReceiptDate = item;
  $('#receipt-date-description').textContent = `Comprobante ${item.comprobante} · ${item.vecino} · Pago #${item.pago.id}`;
  $('#receipt-date-form').elements.fecha.value = item.pago.fecha || '';
  $('#receipt-date-error').hidden = true;
  $('#receipt-date-dialog').showModal();
}

async function saveReceiptDate(form) {
  const item = editingReceiptDate;
  const activeSession = session;
  if (!item || !activeSession || savingReceiptDate) return;
  const payment = item.pago;
  const applications = payment.aplicaciones.map(application => ({ mes: application.mes, monto: Number(application.monto) }));
  const original = { fecha: payment.fecha, monto: Number(payment.monto), aplicaciones: applications };
  const submit = form.querySelector('button[type="submit"]');
  const cancel = $('#receipt-date-cancel');
  savingReceiptDate = true;
  submit.disabled = true;
  cancel.disabled = true;
  $('#receipt-date-error').hidden = true;
  try {
    try {
      await rpc('cuotas_editar_pago', {
        p_pago: Number(payment.id), p_fecha: form.elements.fecha.value,
        p_monto: original.monto, p_aplicaciones: applications, p_original: original
      });
    } catch (error) {
      if (error.code === 'PGRST202') throw new Error('Para modificar pagos, ejecuta supabase/editar_pago.sql en Supabase.');
      throw error;
    }
    if (session !== activeSession) return;
    if ($('#receipt-date-dialog').open) $('#receipt-date-dialog').close();
    editingReceiptDate = null;
    await updateAfterSave('Fecha del pago guardada.');
  } catch (error) {
    if (session === activeSession && editingReceiptDate === item) {
      $('#receipt-date-error').textContent = error.message;
      $('#receipt-date-error').hidden = false;
    }
  } finally {
    savingReceiptDate = false;
    submit.disabled = false;
    cancel.disabled = false;
  }
}

function showDuplicateReceipts() {
  if (!session || !receipts) return;
  const activeReceipts = receipts.filter(item => !item.pago.anulado_en);
  const owners = new Map();
  for (const item of activeReceipts) {
    const key = item.comprobante.trim().toUpperCase();
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(item.vecinoId);
  }
  const repeated = activeReceipts.filter(item => owners.get(item.comprobante.trim().toUpperCase()).size > 1);
  const list = $('#receipts-duplicates-list');
  list.replaceChildren();
  for (const item of repeated) {
    const row = document.createElement('tr');
    for (const value of [item.comprobante, item.vecino, item.fecha, money.format(item.monto), item.estado]) cell(row, value);
    list.append(row);
  }
  const count = [...owners.values()].filter(ownerIds => ownerIds.size > 1).length;
  $('#receipts-duplicates-status').textContent = count
    ? `${count} ${count === 1 ? 'número repetido' : 'números repetidos'} entre distintos vecinos.`
    : 'No hay comprobantes repetidos entre distintos vecinos.';
  $('#receipts-duplicates-dialog').showModal();
}

function resetPaymentEdit() {
  paymentCalculationVersion++;
  clearTimeout(paymentCalculationTimer);
  paymentCalculationPending = false;
  paymentCalculationFailed = false;
  paymentAutomatic = null;
  editingPayment = null;
  $('#payment-edit-form').reset();
  $('#payment-edit-form').hidden = true;
  $('#payment-edit-months').replaceChildren();
  $('#payment-edit-sum').textContent = '';
  $('#payment-edit-auto-status').textContent = '';
  $('#payment-edit-redistribution').replaceChildren();
}

function originalPayment(payment) {
  return {
    fecha: payment.fecha || null,
    monto: Number(payment.monto),
    aplicaciones: payment.aplicaciones.map(item => ({ mes: item.mes, monto: Number(item.monto) }))
      .sort((a, b) => a.mes.localeCompare(b.mes))
  };
}

function useManualPaymentEdit() {
  paymentCalculationVersion++;
  clearTimeout(paymentCalculationTimer);
  paymentCalculationPending = false;
  paymentCalculationFailed = false;
  paymentAutomatic = null;
  $('#payment-edit-redistribution').replaceChildren();
  $('#payment-edit-auto-status').textContent = 'Ajuste manual. Revisa los meses y montos antes de guardar.';
}

async function calculatePaymentEdit(selected, amount, version) {
  const activeSession = session;
  const date = $('#payment-edit-form').elements.fecha.value || null;
  try {
    const distribution = await rpc('cuotas_previsualizar_redistribucion', {
      p_pago: selected.payment.id, p_fecha: date, p_monto: amount, p_original: originalPayment(selected.payment)
    });
    if (version !== paymentCalculationVersion || session !== activeSession || editingPayment !== selected) return;
    const selectedResult = distribution.find(item => item.id === selected.payment.id);
    if (!selectedResult) throw new Error('La distribución no incluye el pago seleccionado.');
    paymentAutomatic = distribution;
    paymentCalculationPending = false;
    $('#payment-edit-months').replaceChildren();
    for (const application of selectedResult.aplicaciones) addPaymentEditMonth(application);
    updatePaymentEditSum();
    const preview = $('#payment-edit-redistribution');
    preview.replaceChildren();
    const heading = document.createElement('h4');
    heading.textContent = 'Cambios propuestos para todos los pagos vigentes';
    preview.append(heading);
    const describe = applications => applications.length
      ? applications.map(item => `${item.mes.slice(0, 7)}: ${money.format(item.monto)}`).join(', ')
      : 'Sin meses';
    for (const item of distribution) {
      const entry = document.createElement('div');
      const label = document.createElement('strong');
      label.textContent = `Comprobante ${item.comprobante || 'sin número'} · Pago #${item.id} · ${item.fecha || 'sin fecha'} · ${money.format(item.monto)}`;
      const before = document.createElement('p');
      before.textContent = `Antes: ${describe(item.antes.aplicaciones)}`;
      const after = document.createElement('p');
      after.textContent = `Después: ${describe(item.aplicaciones)}`;
      entry.append(label, before, after);
      preview.append(entry);
    }
    $('#payment-edit-auto-status').textContent = 'Pagos redistribuidos. Revisa todos los cambios antes de guardar.';
  } catch (error) {
    if (version !== paymentCalculationVersion || session !== activeSession || editingPayment !== selected) return;
    paymentCalculationPending = false;
    paymentCalculationFailed = true;
    $('#payment-edit-auto-status').textContent = error.code === 'PGRST202'
      ? 'Para recalcular, ejecuta supabase/redistribuir_pagos.sql en Supabase.'
      : `No se pudieron recalcular los meses: ${error.message}`;
  }
}

function schedulePaymentCalculation(force = false) {
  if (!editingPayment) return;
  const form = $('#payment-edit-form');
  const amount = Number(form.elements.monto.value);
  const selected = editingPayment;
  const version = ++paymentCalculationVersion;
  clearTimeout(paymentCalculationTimer);
  paymentAutomatic = null;
  $('#payment-edit-redistribution').replaceChildren();
  paymentCalculationPending = false;
  paymentCalculationFailed = false;
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000000000) {
    $('#payment-edit-auto-status').textContent = 'Ingresa un monto válido para recalcular los meses.';
    return;
  }
  if (amount === Number(selected.payment.monto) && !force) {
    $('#payment-edit-months').replaceChildren();
    for (const application of selected.payment.aplicaciones) addPaymentEditMonth(application);
    updatePaymentEditSum();
    $('#payment-edit-auto-status').textContent = '';
    return;
  }
  paymentCalculationPending = true;
  $('#payment-edit-auto-status').textContent = 'Recalculando meses…';
  paymentCalculationTimer = setTimeout(() => calculatePaymentEdit(selected, amount, version), 350);
}

function updatePaymentEditSum() {
  const amounts = [...document.querySelectorAll('#payment-edit-months input[name="aplicado"]')];
  const valid = amounts.every(input => input.validity.valid && input.value !== '');
  const total = amounts.reduce((sum, input) => sum + Number(input.value), 0);
  $('#payment-edit-sum').textContent = valid
    ? `Total aplicado a meses: ${money.format(total)}.`
    : 'Completa los montos aplicados a cada mes.';
}

function addPaymentEditMonth(application = null) {
  const row = document.createElement('div');
  row.className = 'payment-edit-month';
  const monthLabel = document.createElement('label');
  monthLabel.textContent = 'Mes';
  const month = document.createElement('input');
  month.type = 'month';
  month.name = 'mes';
  month.required = true;
  month.value = application ? application.mes.slice(0, 7) : '';
  month.addEventListener('input', useManualPaymentEdit);
  monthLabel.append(month);
  const amountLabel = document.createElement('label');
  amountLabel.textContent = 'Monto aplicado';
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.name = 'aplicado';
  amount.min = '1';
  amount.max = '1000000000';
  amount.step = '1';
  amount.required = true;
  amount.value = application ? String(application.monto) : '';
  amount.addEventListener('input', () => { useManualPaymentEdit(); updatePaymentEditSum(); });
  amountLabel.append(amount);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'outline';
  remove.textContent = 'Quitar mes';
  remove.addEventListener('click', () => { useManualPaymentEdit(); row.remove(); updatePaymentEditSum(); });
  row.append(monthLabel, amountLabel, remove);
  $('#payment-edit-months').append(row);
  updatePaymentEditSum();
}

function startPaymentEdit(payment, neighbor) {
  resetPaymentEdit();
  editingPayment = { payment, neighbor };
  const form = $('#payment-edit-form');
  form.elements.fecha.value = payment.fecha || '';
  form.elements.monto.value = payment.monto;
  $('#payment-edit-description').textContent = `${neighbor.nombre} · Comprobante: ${payment.comprobante || '—'}`;
  for (const application of payment.aplicaciones) addPaymentEditMonth(application);
  updatePaymentEditSum();
  form.hidden = false;
  form.elements.fecha.focus();
}

async function searchPaymentEdit() {
  const query = paymentEditQuery;
  const version = ++paymentEditVersion;
  const activeSession = session;
  const snapshot = [...neighbors];
  $('#payment-edit-results').replaceChildren();
  if (!query || !activeSession) {
    $('#payment-edit-search-status').textContent = 'Ingresa un número de comprobante.';
    return;
  }
  $('#payment-edit-search-status').textContent = 'Buscando comprobante…';
  try {
    const histories = await fetchNeighborHistories(snapshot, () => version === paymentEditVersion && session === activeSession);
    if (version !== paymentEditVersion || session !== activeSession) return;
    let matches = 0;
    for (const neighbor of snapshot) {
      for (const payment of histories.get(String(neighbor.id))) {
        if (!payment.comprobante || !payment.comprobante.toUpperCase().includes(query.toUpperCase())) continue;
        const result = document.createElement('div');
        result.className = 'payment-edit-result';
        const detail = document.createElement('span');
        const date = payment.fecha ? payment.fecha.split('-').reverse().join('/') : '';
        detail.textContent = `${neighbor.nombre} · Comprobante: ${payment.comprobante} · Pago #${payment.id}${date ? ` · ${date}` : ''} · ${money.format(payment.monto)}${payment.anulado_en ? ' · Anulado' : ''}`;
        result.append(detail);
        if (!payment.anulado_en) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'outline';
          button.textContent = 'Modificar';
          button.setAttribute('aria-label', `Modificar pago ${payment.id}, comprobante ${payment.comprobante} de ${neighbor.nombre}${date ? `, ${date}` : ''}, ${money.format(payment.monto)}`);
          button.addEventListener('click', () => startPaymentEdit(payment, neighbor));
          result.append(button);
        }
        $('#payment-edit-results').append(result);
        matches++;
      }
    }
    $('#payment-edit-search-status').textContent = matches
      ? `${matches} ${matches === 1 ? 'pago encontrado' : 'pagos encontrados'}.`
      : 'No se encontraron pagos para ese comprobante.';
  } catch (error) {
    if (version !== paymentEditVersion || session !== activeSession) return;
    paymentEditVersion++;
    $('#payment-edit-results').replaceChildren();
    $('#payment-edit-search-status').textContent = `No se pudo buscar el comprobante: ${error.message}`;
  }
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
  form.elements.numero_socio.value = neighbor.numero_socio || '';
  form.elements.inicio.value = editingNeighbor.inicio;
  form.elements.no_paga_cuota.checked = neighbor.no_paga_cuota;
  $('#neighbor-form-title').textContent = 'Modificar vecino';
  $('#neighbor-submit').textContent = 'Guardar cambios';
  $('#neighbor-cancel').hidden = false;
  message.hidden = true;
  form.elements.nombre.focus();
}

function sortNeighborRows(items, key, direction) {
  const collator = new Intl.Collator('es-CL', { numeric: true, sensitivity: 'base' });
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    let left = a[key] ?? '';
    let right = b[key] ?? '';
    if (key === 'cuota') {
      left = a.no_paga_cuota ? 'No paga cuota' : 'Paga cuota';
      right = b.no_paga_cuota ? 'No paga cuota' : 'Paga cuota';
    }
    return collator.compare(String(left), String(right)) * multiplier;
  });
}

function renderNeighborList() {
  const list = $('#neighbors-list');
  list.replaceChildren();
  const sorted = sortNeighborRows(neighbors, neighborSort.key, neighborSort.direction);
  $('#neighbors-empty').hidden = neighbors.length > 0;
  for (const neighbor of sorted) {
    const row = document.createElement('tr');
    cell(row, neighbor.nombre);
    cell(row, neighbor.rut);
    cell(row, neighbor.numero_socio || '');
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
    list.append(row);
  }
  for (const header of document.querySelectorAll('#neighbors-sort-headers th[aria-sort]')) {
    const button = header.querySelector('[data-neighbor-sort]');
    const active = button.dataset.neighborSort === neighborSort.key;
    header.setAttribute('aria-sort', active ? (neighborSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  }
}

function sortNeighborsBy(key) {
  if (neighborSort.key === key) {
    neighborSort.direction = neighborSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    neighborSort = { key, direction: 'asc' };
  }
  renderNeighborList();
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

function renderCurrentFee(fees) {
  const year = new Date().getFullYear();
  const fee = fees.find(item => Number(item.anio) === year);
  $('#current-fee').textContent = fee
    ? `Cuota mensual actual (${year}): ${money.format(fee.monto)}.`
    : `No se ha configurado la cuota mensual para ${year}.`;
}

function renderFeeList(fees) {
  const list = $('#fee-list');
  list.replaceChildren();
  for (const fee of [...fees].sort((a, b) => Number(b.anio) - Number(a.anio))) {
    const row = document.createElement('tr');
    cell(row, String(fee.anio));
    cell(row, money.format(fee.monto));
    list.append(row);
  }
  $('#fee-list-table').hidden = !fees.length;
  $('#fee-list-status').textContent = fees.length ? '' : 'No hay valores de cuota registrados.';
}

function render(data) {
  const select = $('#payment-form').elements.vecino;
  const selected = select.value;
  const historySelected = $('#history-neighbor').value;
  const historyYearSelected = $('#history-year-neighbor').value;
  select.replaceChildren(new Option('Selecciona un vecino', ''));
  neighbors = data.vecinos;
  for (const neighbor of data.vecinos) {
    if (!neighbor.no_paga_cuota) select.add(new Option(`${neighbor.nombre} · ${neighbor.rut}`, neighbor.id));
  }
  renderNeighborList();
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
  updateHistoryOptions(true);
  if (historySelected && !$('#history-neighbor').value) loadHistory();
  updateHistoryOptions(true, 'history-year');
  if (historyYearSelected && !$('#history-year-neighbor').value) loadHistoryYear();

  let total = 0;
  const paidTotal = data.pagos.reduce((sum, payment) => payment.anulado_en ? sum : sum +
    payment.aplicaciones.filter(item => Number(item.mes.slice(0, 4)) === Number(yearInput.value))
      .reduce((subtotal, item) => subtotal + Number(item.monto), 0), 0);
  let unconfigured = false;
  for (const due of data.cuotas) {
    const balance = due.monto === null ? null : Math.max(due.monto - due.pagado, 0);
    if (balance !== null) total += balance;
    else unconfigured = true;
  }
  renderCurrentFee(data.aranceles);
  renderFeeList(data.aranceles);
  $('#summary-neighbors').textContent = String(data.vecinos.length);
  $('#summary-paid').textContent = money.format(paidTotal);
  $('#summary-debt').textContent = money.format(total);
  $('#summary-info').textContent = unconfigured
    ? `Resumen de ${yearInput.value}. Hay cuotas sin monto configurado; la deuda mostrada no las incluye.`
    : `Resumen de ${yearInput.value}. Los montos pagados corresponden a cuotas aplicadas a ese año.`;
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
  paymentEditVersion++;
  if (paymentEditQuery) {
    $('#payment-edit-results').replaceChildren();
    $('#payment-edit-search-status').textContent = 'Actualizando resultados…';
  }
  if (historyReceiptQuery) {
    $('#payments').replaceChildren();
    $('#history-status').textContent = 'Actualizando resultados…';
  }
  clearHistoryOverview();
  clearReceipts();
  try {
    await load();
    clearHistoryOverview();
    if (historyReceiptQuery) await loadHistoryReceipt();
    else if ($('#history-neighbor').value) await loadHistory();
    if ($('#history-year-neighbor').value) await loadHistoryYear();
    if (!$('#view-history-overview').hidden) await loadHistoryOverview();
    if (!$('#view-receipts').hidden) await loadReceipts();
    if (paymentEditQuery) await searchPaymentEdit();
    showMessage(text);
  } catch (error) {
    if (historyReceiptQuery) $('#history-status').textContent = `No se pudo actualizar la búsqueda: ${error.message}`;
    if (paymentEditQuery) $('#payment-edit-search-status').textContent = `No se pudo actualizar la búsqueda: ${error.message}`;
    if ($('#current-fee').textContent === 'Actualizando valor de la cuota…') {
      $('#current-fee').textContent = 'No se pudo actualizar el valor de la cuota.';
      $('#fee-list-status').textContent = 'No se pudo actualizar el listado de valores.';
    }
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
    if (button.dataset.view === 'receipts') loadReceipts();
  }
});

$('#neighbors-sort-headers').addEventListener('click', event => {
  const button = event.target.closest('[data-neighbor-sort]');
  if (button) sortNeighborsBy(button.dataset.neighborSort);
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
$('#receipts-refresh').addEventListener('click', loadReceipts);
$('#receipts-sort-headers').addEventListener('click', event => {
  const button = event.target.closest('[data-receipt-sort]');
  if (button) sortReceiptsBy(button.dataset.receiptSort);
});
$('#receipts-duplicates').addEventListener('click', showDuplicateReceipts);
$('#receipt-date-form').addEventListener('submit', event => {
  event.preventDefault();
  saveReceiptDate(event.currentTarget);
});
$('#receipt-date-cancel').addEventListener('click', () => $('#receipt-date-dialog').close());
$('#receipt-date-dialog').addEventListener('cancel', event => {
  if (savingReceiptDate) event.preventDefault();
});
$('#receipt-date-dialog').addEventListener('close', () => { editingReceiptDate = null; });
$('#export-receipts').addEventListener('click', async () => {
  if (!session || !receipts?.length || receiptsExporting) return;
  const activeSession = session;
  const currentReceipts = receipts;
  const version = receiptsVersion;
  receiptsExporting = true;
  $('#export-receipts').disabled = true;
  message.hidden = true;
  try {
    const buffer = await ExportarVecinos.crearArchivoComprobantes(currentReceipts);
    if (session !== activeSession || version !== receiptsVersion || receipts !== currentReceipts) {
      throw new Error('La sesión o los datos cambiaron. Vuelve a intentar la descarga.');
    }
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'comprobantes.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (session === activeSession) showMessage(`No se pudo descargar el Excel: ${error.message}`, true);
  } finally {
    receiptsExporting = false;
    $('#export-receipts').disabled = !receipts?.length;
  }
});
$('#export-history-overview').addEventListener('click', async () => {
  if (!session || !historyOverviewPayments || historyOverviewExporting) return;
  const activeSession = session;
  const data = historyOverviewPayments;
  const version = historyOverviewVersion;
  const year = $('#history-overview-year').value;
  historyOverviewExporting = true;
  updateOverviewExportButton();
  message.hidden = true;
  try {
    const buffer = await ExportarVecinos.crearArchivoPagosPorAnio(year, overviewRows(year));
    if (session !== activeSession || historyOverviewVersion !== version || historyOverviewPayments !== data
      || $('#history-overview-year').value !== year) {
      throw new Error('La sesión o los datos cambiaron. Vuelve a intentar la descarga.');
    }
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pagos-por-ano-${year}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (session === activeSession) showMessage(`No se pudo descargar el Excel: ${error.message}`, true);
  } finally {
    historyOverviewExporting = false;
    updateOverviewExportButton();
  }
});

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
      p_no_paga_cuota: form.elements.no_paga_cuota.checked,
      p_numero_socio: form.elements.numero_socio.value.trim() || null
    };
    const name = neighbor ? 'cuotas_editar_vecino' : 'cuotas_crear_vecino';
    const args = neighbor ? { p_vecino: neighbor.id, ...parameters } : parameters;
    try {
      await rpc(name, args);
    } catch (error) {
      if (error.code !== 'PGRST202') throw error;
      if (parameters.p_numero_socio !== null) {
        throw new Error('Para guardar el número de socio, ejecuta supabase/numero_socio.sql en Supabase.');
      }
      const { p_numero_socio, ...withoutMemberNumber } = args;
      try {
        await rpc(name, withoutMemberNumber);
      } catch (legacyError) {
        if (legacyError.code !== 'PGRST202') throw legacyError;
        if (parameters.p_no_paga_cuota || neighbor?.no_paga_cuota !== undefined) {
          throw new Error('Para habilitar esta opción, ejecuta supabase/exencion_cuotas.sql en Supabase.');
        }
        const { p_no_paga_cuota, ...legacyArgs } = withoutMemberNumber;
        await rpc(name, legacyArgs);
      }
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

$('#export-cuotas').addEventListener('click', async event => {
  if (!session) return;
  const button = event.currentTarget;
  let activeSession = session;
  button.disabled = true;
  $('#export-cuotas-status').textContent = 'Preparando Excel…';
  try {
    await accessToken();
    activeSession = session;
    const data = await rpc('cuotas_exportar_cuotas', {});
    if (session !== activeSession) return;
    const buffer = await ExportarVecinos.crearArchivoCuotas(data);
    if (session !== activeSession) return;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cuotas-universal.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('#export-cuotas-status').textContent = 'Excel preparado con los datos del sistema.';
  } catch (error) {
    if (session === activeSession) {
      $('#export-cuotas-status').textContent = error.code === 'PGRST202'
        ? 'Para habilitar la descarga, ejecuta supabase/exportar_cuotas.sql en Supabase.'
        : `No se pudo descargar el Excel: ${error.message}`;
    }
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
    $('#current-fee').textContent = 'Actualizando valor de la cuota…';
    $('#fee-list').replaceChildren();
    $('#fee-list-table').hidden = true;
    $('#fee-list-status').textContent = 'Actualizando valores de cuota…';
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
    resetPaymentEdit();
    await updateAfterSave('Pago registrado.');
  });
});

$('#payment-edit-search').addEventListener('input', () => {
  paymentEditVersion++;
  paymentEditQuery = '';
  resetPaymentEdit();
  $('#payment-edit-results').replaceChildren();
  $('#payment-edit-search-status').textContent = 'Ingresa un comprobante y pulsa Buscar comprobante.';
});
$('#payment-edit-search-form').addEventListener('submit', event => {
  event.preventDefault();
  resetPaymentEdit();
  paymentEditQuery = $('#payment-edit-search').value.trim();
  searchPaymentEdit();
});
$('#payment-edit-add-month').addEventListener('click', () => { useManualPaymentEdit(); addPaymentEditMonth(); });
$('#payment-edit-recalculate').addEventListener('click', () => schedulePaymentCalculation(true));
$('#payment-edit-form').addEventListener('input', event => {
  if (event.target.name === 'monto') schedulePaymentCalculation();
  if (event.target.name === 'fecha' && (paymentAutomatic || paymentCalculationPending || paymentCalculationFailed)) {
    schedulePaymentCalculation(true);
  }
});
$('#payment-edit-cancel').addEventListener('click', resetPaymentEdit);
$('#payment-edit-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const selected = editingPayment;
  if (!selected) return;
  const applications = [...document.querySelectorAll('#payment-edit-months .payment-edit-month')].map(row => ({
    mes: `${row.querySelector('input[name="mes"]').value}-01`,
    monto: Number(row.querySelector('input[name="aplicado"]').value)
  })).sort((a, b) => a.mes.localeCompare(b.mes));
  if (new Set(applications.map(item => item.mes)).size !== applications.length) {
    showMessage('No puedes repetir un mes en el mismo pago.', true);
    return;
  }
  const original = originalPayment(selected.payment);
  const amount = Number(form.elements.monto.value);
  if (paymentCalculationPending) {
    showMessage('Espera a que termine el recálculo de meses.', true);
    return;
  }
  if (paymentCalculationFailed) {
    showMessage('Corrige el error de recálculo o ajusta los meses manualmente.', true);
    return;
  }
  const total = applications.reduce((sum, item) => sum + item.monto, 0);
  if ((amount !== original.monto || JSON.stringify(applications) !== JSON.stringify(original.aplicaciones)) && total !== amount) {
    showMessage('La suma aplicada a los meses debe coincidir con el monto del pago.', true);
    return;
  }
  if (!confirm(`¿Guardar la modificación del comprobante ${selected.payment.comprobante} de ${selected.neighbor.nombre}? Monto: ${money.format(amount)}.${paymentAutomatic ? ' Se redistribuirán todos sus pagos vigentes según la vista previa.' : ' Esto puede modificar la deuda y los totales.'}`)) return;
  const activeSession = session;
  withBusy(form, async () => {
    try {
      const parameters = {
        p_pago: selected.payment.id, p_fecha: form.elements.fecha.value || null,
        p_monto: amount, p_original: original
      };
      if (paymentAutomatic) {
        await rpc('cuotas_guardar_redistribucion', { ...parameters, p_distribucion: paymentAutomatic });
      } else {
        await rpc('cuotas_editar_pago', { ...parameters, p_aplicaciones: applications });
      }
    } catch (error) {
      if (error.code === 'PGRST202') throw new Error(paymentAutomatic
        ? 'Para recalcular, ejecuta supabase/redistribuir_pagos.sql en Supabase.'
        : 'Para modificar pagos, ejecuta supabase/editar_pago.sql en Supabase.');
      throw error;
    }
    if (session !== activeSession) return;
    if (editingPayment === selected) resetPaymentEdit();
    await updateAfterSave('Pago modificado.');
  });
});

async function cancelPayment(id, button) {
  const reason = prompt('Indica el motivo de la anulación:');
  if (reason === null) return;
  if (!reason.trim()) { showMessage('Debes indicar un motivo de anulación.', true); return; }
  button.disabled = true;
  try {
    await rpc('cuotas_anular_pago', { p_pago: id, p_motivo: reason });
    resetPaymentEdit();
    await updateAfterSave('Pago anulado.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function changeYear(value) {
  yearInput.value = value;
  load().catch(error => showMessage(error.message, true));
}

yearInput.addEventListener('change', () => changeYear(yearInput.value));
const today = new Date();
for (let year = 2100; year >= 2000; year--) {
  $('#history-year-select').add(new Option(String(year), String(year)));
}
for (let year = overviewLastYear; year >= overviewFirstYear; year--) {
  $('#history-overview-year').add(new Option(String(year), String(year)));
}
$('#history-year-select').value = String(today.getFullYear());
$('#history-overview-year').value = defaultOverviewYear();
yearInput.value = today.getFullYear();
$('#fee-form').elements.anio.value = today.getFullYear();
$('#payment-form').elements.fecha.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
