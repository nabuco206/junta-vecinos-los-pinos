import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

class Element {
  constructor(text = '', value = '') {
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.value = value;
    this.textContent = text;
    this.elements = { anio: {}, fecha: {}, mes: {} };
    this.className = '';
    this.classList = {
      add: name => { this.className = `${this.className} ${name}`.trim(); },
      toggle() {}
    };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  add(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

test('el selector de Pagos por Año contiene exclusivamente los años 2014 a 2027', () => {
  const app = setup([]);
  const options = app.document.querySelector('#history-overview-year').children;
  assert.deepEqual(options.map(option => option.value), Array.from({ length: 14 }, (_, i) => String(2027 - i)));
  const selected = Number(app.document.querySelector('#history-overview-year').value);
  assert.ok(selected >= 2014 && selected <= 2027);
});

test('el recálculo muestra la propuesta y descarta respuestas anteriores', async () => {
  const app = setup([]);
  app.context.payment = { id: 10, fecha: null, monto: 2000, aplicaciones: [{ mes: '2021-01-01', monto: 2000 }] };
  let resolveFirst;
  app.context.mockRpc = (_, args) => args.p_monto === 3000
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve([{ id: 10, monto: 500, antes: { aplicaciones: [] }, aplicaciones: [{ mes: '2021-01-01', monto: 500 }] }]);
  runInContext('session = {}; editingPayment = { payment }; rpc = mockRpc; paymentCalculationVersion = 1', app.context);
  const first = runInContext('calculatePaymentEdit(editingPayment, 3000, 1)', app.context);
  runInContext('paymentCalculationVersion = 2', app.context);
  await runInContext('calculatePaymentEdit(editingPayment, 500, 2)', app.context);
  resolveFirst([{ id: 10, monto: 3000, antes: { aplicaciones: [] }, aplicaciones: [{ mes: '2021-01-01', monto: 3000 }] }]);
  await first;
  assert.match(app.document.querySelector('#payment-edit-auto-status').textContent, /Pagos redistribuidos/);
  assert.equal(app.document.querySelector('#payment-edit-months').children[0].children[1].children[0].value, '500');
  assert.equal(runInContext('paymentAutomatic[0].monto', app.context), 500);
});

test('el error de recálculo bloquea la propuesta hasta un ajuste manual', async () => {
  const app = setup([]);
  app.context.payment = { id: 10, fecha: null, monto: 2000, aplicaciones: [] };
  app.context.mockRpc = async () => { throw new Error('Falta configurar el monto'); };
  runInContext('session = {}; editingPayment = { payment }; rpc = mockRpc; paymentCalculationVersion = 1', app.context);
  await runInContext('calculatePaymentEdit(editingPayment, 3000, 1)', app.context);
  assert.equal(runInContext('paymentCalculationFailed', app.context), true);
  assert.match(app.document.querySelector('#payment-edit-auto-status').textContent, /Falta configurar/);
  runInContext('useManualPaymentEdit()', app.context);
  assert.equal(runInContext('paymentCalculationFailed', app.context), false);
});

test('ordena vecinos alfabéticamente y números de socio en orden natural', () => {
  const app = setup([]);
  app.context.testNeighbors = [
    { id: 1, nombre: 'Zoe', numero_socio: '10' },
    { id: 2, nombre: 'Ángela', numero_socio: '2' },
    { id: 3, nombre: 'Ana', numero_socio: '001' }
  ];
  assert.deepEqual(
    Array.from(runInContext("sortNeighborRows(testNeighbors, 'nombre', 'asc')", app.context), neighbor => neighbor.id),
    [3, 2, 1]
  );
  assert.deepEqual(
    Array.from(runInContext("sortNeighborRows(testNeighbors, 'numero_socio', 'asc')", app.context), neighbor => neighbor.id),
    [3, 2, 1]
  );
  assert.deepEqual(
    Array.from(runInContext("sortNeighborRows(testNeighbors, 'numero_socio', 'desc')", app.context), neighbor => neighbor.id),
    [1, 2, 3]
  );
});

test('lista comprobantes de todos los vecinos, incluyendo repetidos y anulados', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Luis' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1
    ? [{ comprobante: '406', fecha: null, monto: 1000 }, { comprobante: null, monto: 300 }]
    : [{ comprobante: '2', fecha: '2025-03-04', monto: 500, anulado_en: '2025-03-05' }, { comprobante: '406', fecha: null, monto: 700 }];
  runInContext('neighbors = neighborList; session = {}; rpc = mockRpc', app.context);
  await runInContext('loadReceipts()', app.context);
  const rows = app.document.querySelector('#receipts-list').children;
  assert.deepEqual(rows.map(row => row.children.slice(0, 5).map(item => item.textContent)), [
    ['2', 'Luis', '04/03/2025', '$500', 'Anulado'],
    ['406', 'Ana', '', '$1.000', 'Registrado'],
    ['406', 'Luis', '', '$700', 'Registrado']
  ]);
  assert.equal(app.document.querySelector('#export-receipts').disabled, false);
  assert.equal(rows[0].children[5].children.length, 0);
  assert.equal(rows[1].children[5].children[0].textContent, 'Ingresar fecha');
  app.context.mockRpc = async () => { throw new Error('Conexión perdida'); };
  runInContext('rpc = mockRpc', app.context);
  await runInContext('loadReceipts()', app.context);
  assert.equal(app.document.querySelector('#receipts-list').children.length, 0);
  assert.match(app.document.querySelector('#receipts-status').textContent, /Conexión perdida/);
  assert.equal(app.document.querySelector('#export-receipts').disabled, true);
});

test('ordena comprobantes por fecha, monto y texto en ambos sentidos', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Zoe' }, { id: 2, nombre: 'Ana' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1
    ? [{ id: 1, comprobante: '10', fecha: '2024-12-01', monto: 200 }]
    : [{ id: 2, comprobante: '2', fecha: '2025-01-02', monto: 100, anulado_en: '2025-02-01' },
       { id: 3, comprobante: '1', fecha: null, monto: 150 }];
  runInContext('neighbors = neighborList; session = {}; rpc = mockRpc', app.context);
  await runInContext('loadReceipts()', app.context);
  const numbers = () => app.document.querySelector('#receipts-list').children.map(row => row.children[0].textContent);
  assert.deepEqual(numbers(), ['1', '2', '10']);
  runInContext("sortReceiptsBy('fecha')", app.context);
  assert.deepEqual(numbers(), ['10', '2', '1']);
  runInContext("sortReceiptsBy('fecha')", app.context);
  assert.deepEqual(numbers(), ['2', '10', '1']);
  runInContext("sortReceiptsBy('monto')", app.context);
  assert.deepEqual(numbers(), ['2', '1', '10']);
  runInContext("sortReceiptsBy('monto')", app.context);
  assert.deepEqual(numbers(), ['10', '1', '2']);
  runInContext("sortReceiptsBy('vecino')", app.context);
  assert.deepEqual(numbers(), ['1', '2', '10']);
  runInContext("sortReceiptsBy('estado')", app.context);
  assert.equal(numbers()[0], '2');
  runInContext("sortReceiptsBy('estado')", app.context);
  assert.equal(numbers()[2], '2');
  assert.equal(runInContext('receipts[2].comprobante', app.context), '2');
  await runInContext('loadReceipts()', app.context);
  assert.equal(numbers()[2], '2');
});

test('guarda la fecha de un comprobante sin alterar el monto ni las aplicaciones', async () => {
  const app = setup([]);
  const item = {
    comprobante: '406', vecino: 'Ana', pago: {
      id: 8, fecha: null, monto: 1000, aplicaciones: [{ mes: '2018-01-01', monto: 500 }]
    }
  };
  app.context.item = item;
  app.context.calls = [];
  app.context.mockRpc = async (name, args) => { app.context.calls.push({ name, args }); };
  app.context.mockUpdate = async text => { app.context.updated = text; };
  const form = app.document.querySelector('#receipt-date-form');
  const submit = new Element();
  form.querySelector = () => submit;
  form.elements.fecha = { value: '' };
  runInContext('session = {}; rpc = mockRpc; updateAfterSave = mockUpdate; openReceiptDate(item)', app.context);
  form.elements.fecha.value = '2024-06-03';
  await runInContext('saveReceiptDate(document.querySelector("#receipt-date-form"))', app.context);
  assert.equal(app.context.calls.length, 1);
  const { name, args } = app.context.calls[0];
  assert.equal(name, 'cuotas_editar_pago');
  assert.equal(args.p_pago, 8);
  assert.equal(args.p_fecha, '2024-06-03');
  assert.equal(args.p_monto, 1000);
  assert.equal(args.p_original.fecha, null);
  assert.equal(args.p_original.monto, 1000);
  assert.deepEqual(Array.from(args.p_aplicaciones, a => [a.mes, a.monto]), [['2018-01-01', 500]]);
  assert.deepEqual(Array.from(args.p_original.aplicaciones, a => [a.mes, a.monto]), [['2018-01-01', 500]]);
  assert.equal(app.context.updated, 'Fecha del pago guardada.');
  assert.equal(app.document.querySelector('#receipt-date-dialog').open, false);
});

test('muestra errores de edición en el diálogo y conserva la fecha ingresada', async () => {
  const app = setup([]);
  app.context.item = { comprobante: '1', vecino: 'Ana', pago: { id: 1, fecha: null, monto: 1000, aplicaciones: [] } };
  app.context.mockRpc = async () => { throw Object.assign(new Error('No existe'), { code: 'PGRST202' }); };
  const form = app.document.querySelector('#receipt-date-form');
  form.elements.fecha = { value: '' };
  form.querySelector = () => new Element();
  runInContext('session = {}; rpc = mockRpc; openReceiptDate(item)', app.context);
  form.elements.fecha.value = '2024-06-03';
  await runInContext('saveReceiptDate(document.querySelector("#receipt-date-form"))', app.context);
  assert.equal(form.elements.fecha.value, '2024-06-03');
  assert.equal(app.document.querySelector('#receipt-date-dialog').open, true);
  assert.match(app.document.querySelector('#receipt-date-error').textContent, /editar_pago.sql/);
  assert.equal(app.document.querySelector('#receipt-date-error').hidden, false);
});

test('descarta el listado de comprobantes si se cierra la sesión durante la carga', async () => {
  const app = setup([]);
  let resolve;
  app.context.mockRpc = () => new Promise(done => { resolve = done; });
  runInContext('session = {}; rpc = mockRpc', app.context);
  const loading = runInContext('loadReceipts()', app.context);
  runInContext('session = null; clearReceipts()', app.context);
  resolve([{ comprobante: '406', monto: 1000 }]);
  await loading;
  assert.equal(app.document.querySelector('#receipts-list').children.length, 0);
  assert.equal(app.document.querySelector('#export-receipts').disabled, true);
});

test('el diálogo excluye pagos anulados al detectar comprobantes repetidos', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Ana' }, { id: 3, nombre: 'Luis' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1
    ? [{ comprobante: ' abc ', monto: 100 }, { comprobante: 'abc', monto: 200 }, { comprobante: '2', monto: 300 }, { comprobante: '2', monto: 400 }]
    : args.p_vecino === 2
      ? [{ comprobante: 'ABC', monto: 500, anulado_en: '2025-01-01' }, { comprobante: '02', monto: 600 }, { comprobante: '2', monto: 700 }]
      : [{ comprobante: '2', monto: 800, anulado_en: '2025-01-01' }];
  runInContext('neighbors = neighborList; session = {}; rpc = mockRpc', app.context);
  await runInContext('loadReceipts();', app.context);
  runInContext('showDuplicateReceipts()', app.context);
  const dialog = app.document.querySelector('#receipts-duplicates-dialog');
  const rows = app.document.querySelector('#receipts-duplicates-list').children;
  assert.equal(dialog.open, true);
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['2', '2', '2']);
  assert.ok(rows.every(row => row.children[4].textContent === 'Registrado'));
  assert.match(app.document.querySelector('#receipts-duplicates-status').textContent, /^1 número repetido/);
  assert.equal(app.document.querySelector('#receipts-list').children.length, 8);
  runInContext("receipts.find(item => item.vecinoId === '2' && item.comprobante === '2').pago.anulado_en = '2025-01-02'", app.context);
  runInContext("document.querySelector('#receipts-duplicates-dialog').close(); showDuplicateReceipts()", app.context);
  assert.equal(app.document.querySelector('#receipts-duplicates-list').children.length, 0);
  assert.match(app.document.querySelector('#receipts-duplicates-status').textContent, /No hay comprobantes repetidos/);
  runInContext('clearReceipts()', app.context);
  assert.equal(dialog.open, false);
  assert.equal(app.document.querySelector('#receipts-duplicates-list').children.length, 0);
});

test('el diálogo informa cuando no hay comprobantes repetidos', async () => {
  const app = setup([]);
  app.context.mockRpc = async () => [{ comprobante: '10', monto: 100 }];
  runInContext('session = {}; rpc = mockRpc', app.context);
  await runInContext('loadReceipts()', app.context);
  runInContext('showDuplicateReceipts()', app.context);
  assert.match(app.document.querySelector('#receipts-duplicates-status').textContent, /No hay comprobantes repetidos/);
  assert.equal(app.document.querySelector('#receipts-duplicates-list').children.length, 0);
});

function setup() {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return new Element(); }
  };
  document.querySelector('#monthly-payments-form').querySelector = () => new Element();
  const context = createContext({ document, Option: Element, setTimeout, clearTimeout });
  runInContext(readFileSync(new URL('../vista-cuotas.js', import.meta.url), 'utf8'), context);
  runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
  runInContext("neighbors = [{ id: 1, nombre: 'Vecino' }]", context);
  document.querySelector('#history-year-neighbor').value = '1';
  return { context, document };
}

test('muestra la cuota del año actual independientemente del año del tablero', () => {
  const app = setup([]);
  const currentYear = new Date().getFullYear();
  app.document.querySelector('#year').value = String(currentYear - 1);
  app.context.fees = [{ anio: currentYear - 1, monto: 500 }, { anio: currentYear, monto: 1000 }];
  runInContext('renderCurrentFee(fees)', app.context);
  assert.equal(app.document.querySelector('#current-fee').textContent, `Cuota mensual actual (${currentYear}): $1.000.`);
  app.context.fees = [{ anio: currentYear - 1, monto: 500 }];
  runInContext('renderCurrentFee(fees)', app.context);
  assert.equal(app.document.querySelector('#current-fee').textContent, `No se ha configurado la cuota mensual para ${currentYear}.`);
});

test('lista todos los valores por año y actualiza la lista cuando cambian', () => {
  const app = setup([]);
  app.context.fees = [{ anio: 2020, monto: 1000 }, { anio: 2025, monto: 1500 }, { anio: 2023, monto: 1200 }];
  runInContext('renderFeeList(fees)', app.context);
  const list = app.document.querySelector('#fee-list');
  assert.deepEqual(list.children.map(row => row.children.map(item => item.textContent)), [
    ['2025', '$1.500'], ['2023', '$1.200'], ['2020', '$1.000']
  ]);
  assert.equal(app.document.querySelector('#fee-list-table').hidden, false);
  app.context.fees = [{ anio: 2023, monto: 2000 }];
  runInContext('renderFeeList(fees)', app.context);
  assert.deepEqual(list.children.map(row => row.children.map(item => item.textContent)), [['2023', '$2.000']]);
  runInContext('renderFeeList([])', app.context);
  assert.equal(list.children.length, 0);
  assert.equal(app.document.querySelector('#fee-list-table').hidden, true);
  assert.equal(app.document.querySelector('#fee-list-status').textContent, 'No hay valores de cuota registrados.');
});

test('la vista individual aplica pagos vigentes, exención pandemia y saldos parciales', () => {
  const app = setup();
  app.context.neighbor = { id: 1, nombre: 'Ana', inicio: '2018-12-01', no_paga_cuota: false };
  app.context.fees = [{ anio: 2018, monto: 1000 }, { anio: 2021, monto: 1000 }];
  app.context.payments = [
    { comprobante: '123', aplicaciones: [{ mes: '2018-12-01', monto: 1000 }, { mes: '2021-01-01', monto: 400 }] },
    { comprobante: '124', anulado_en: '2021-01-01', aplicaciones: [{ mes: '2021-01-01', monto: 600 }] }
  ];
  const data = runInContext("buildIndividualDues(neighbor, fees, payments, new Date('2021-02-15T12:00:00Z'))", app.context);
  assert.equal(data.configuracion_completa, true);
  assert.equal(data.deuda_hasta_hoy, 1600);
  assert.equal(data.cuotas.length, 27);
  assert.equal(data.cuotas[1].no_cobrado, true);
  assert.equal(data.cuotas[25].pagado, 400);
  assert.deepEqual(Array.from(data.cuotas[25].comprobantes), ['123']);
  app.context.vista = data;
  runInContext("mostrarVistaCuotas(vista, {status: document.querySelector('#history-year-status'), balance: document.querySelector('#history-year-balance'), dues: document.querySelector('#history-year-months')})", app.context);
  assert.equal(app.document.querySelector('#history-year-status').textContent, 'Estado: Pendiente');
  const years = app.document.querySelector('#history-year-months').children;
  assert.deepEqual(years.map(year => year.dataset.year), ['2021', '2020', '2019', '2018']);
  assert.equal(years[0].children[1].children[0].children[2].textContent, 'Debe $600');
});

test('informa cuotas sin configurar y respeta vecinos exentos', () => {
  const app = setup();
  app.context.neighbor = { inicio: '2021-01-01', no_paga_cuota: false };
  const missing = runInContext("buildIndividualDues(neighbor, [], [], new Date('2021-01-05T00:00:00Z'))", app.context);
  assert.equal(missing.configuracion_completa, false);
  assert.equal(missing.cuotas[0].monto, null);
  app.context.neighbor.no_paga_cuota = true;
  const exempt = runInContext("buildIndividualDues(neighbor, [], [], new Date('2021-01-05T00:00:00Z'))", app.context);
  assert.equal(exempt.configuracion_completa, true);
  assert.equal(exempt.deuda_hasta_hoy, 0);
  assert.equal(exempt.cuotas[0].monto, 0);
});

test('la vista individual descarta respuestas obsoletas al cambiar de vecino', async () => {
  const app = setup();
  let resolveFirst;
  app.context.mockRpc = (name, args) => name === 'cuotas_datos'
    ? Promise.resolve({ vecinos: [{ id: 1, nombre: 'Ana', inicio: '2025-01-01' }, { id: 2, nombre: 'Luis', inicio: '2025-01-01' }], aranceles: [] })
    : args.p_vecino === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve([]);
  runInContext('session = {}; rpc = mockRpc', app.context);
  const first = runInContext('loadHistoryYear()', app.context);
  app.document.querySelector('#history-year-neighbor').value = '2';
  await runInContext('loadHistoryYear()', app.context);
  const status = app.document.querySelector('#history-year-status').textContent;
  resolveFirst([]);
  await first;
  assert.equal(app.document.querySelector('#history-year-status').textContent, status);
});

test('carga el historial de un vecino y muestra su estado individual', async () => {
  const app = setup();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  app.context.mockRpc = async name => name === 'cuotas_datos'
    ? { vecinos: [{ id: 1, nombre: 'Ana', inicio: `${year}-${month}-01`, no_paga_cuota: false }], aranceles: [{ anio: year, monto: 1000 }] }
    : [{ comprobante: '008', aplicaciones: [{ mes: `${year}-${month}-01`, monto: 400 }] }];
  app.document.querySelector('#year').value = String(year);
  runInContext('session = {}; rpc = mockRpc', app.context);
  await runInContext('loadHistoryYear()', app.context);
  assert.equal(app.document.querySelector('#history-year-status').textContent, 'Estado: Pendiente');
  assert.match(app.document.querySelector('#history-year-balance').textContent, /\$600/);
  const card = app.document.querySelector('#history-year-months').children[0].children[1].children[0];
  assert.equal(card.children[1].textContent, 'N.º 008');
  assert.equal(card.children[2].textContent, 'Debe $600');
  app.context.mockRpc = async () => { throw new Error('Conexión perdida'); };
  runInContext('rpc = mockRpc', app.context);
  await runInContext('loadHistoryYear()', app.context);
  assert.match(app.document.querySelector('#history-year-status').textContent, /Conexión perdida/);
  assert.equal(app.document.querySelector('#history-year-months').children.length, 0);
});

test('la vista general muestra cada comprobante vigente y deja en blanco las fechas desconocidas', () => {
  const app = setup([]);
  app.context.overview = {
    snapshot: [{ id: 1, nombre: 'Vecino 1' }, { id: 2, nombre: 'Vecino 2', no_paga_cuota: true }],
    paymentsByNeighbor: new Map([
      ['1', [
        { comprobante: '433', fecha: '2025-02-03', aplicaciones: [{ mes: '2025-01-01', monto: 1000 }, { mes: '2025-02-01', monto: 1000 }, { mes: '2024-01-01', monto: 1200 }] },
        { comprobante: '123', fecha: null, aplicaciones: [{ mes: '2025-01-01', monto: 500 }] },
        { comprobante: 'anulado', fecha: '2025-01-01', anulado_en: '2025-03-01', aplicaciones: [{ mes: '2025-01-01', monto: 1000 }] }
      ]],
      ['2', [{ comprobante: null, fecha: null, aplicaciones: [{ mes: '2025-12-01', monto: 1000 }] }]]
    ])
  };
  runInContext('historyOverviewPayments = overview', app.context);
  app.document.querySelector('#history-overview-year').value = '2025';
  runInContext('renderHistoryOverview()', app.context);
  const rows = app.document.querySelector('#history-overview-rows').children;
  const exportRows = runInContext("overviewRows('2025')", app.context);
  assert.deepEqual(exportRows[0].months[0].map(payment => payment.comprobante).join(','), '433,123');
  assert.equal(exportRows[0].months[2].length, 0);
  assert.equal(rows.length, 2);
  assert.equal(app.document.querySelector('#history-overview-total').textContent, 'Monto recaudado aplicado a cuotas de 2025: $3.500.');
  assert.equal(rows[0].children.length, 13);
  assert.equal(rows[0].children[0].textContent, 'Vecino 1');
  assert.deepEqual(rows[0].children[1].children.map(entry => entry.children.map(item => item.textContent)), [
    ['433', '03/02/2025'], ['123', '']
  ]);
  assert.deepEqual(rows[0].children[2].children[0].children.map(item => item.textContent), ['433', '03/02/2025']);
  assert.equal(rows[0].children[3].children.length, 0);
  assert.equal(rows[1].children[0].children[0].textContent, 'No paga cuota');
  assert.deepEqual(rows[1].children[12].children[0].children.map(item => item.textContent), ['Sin comprobante', '']);
  app.document.querySelector('#history-overview-year').value = '2024';
  runInContext('renderHistoryOverview()', app.context);
  const updated = app.document.querySelector('#history-overview-rows').children;
  assert.equal(updated[0].children[1].children[0].children[0].textContent, '433');
  assert.equal(updated[0].children[2].children.length, 0);
  assert.equal(app.document.querySelector('#history-overview-total').textContent, 'Monto recaudado aplicado a cuotas de 2024: $1.200.');
  app.document.querySelector('#history-overview-year').value = '2023';
  runInContext('renderHistoryOverview()', app.context);
  assert.equal(app.document.querySelector('#history-overview-total').textContent, 'Monto recaudado aplicado a cuotas de 2023: $0.');
  runInContext('clearHistoryOverview()', app.context);
  assert.equal(app.document.querySelector('#history-overview-total').textContent, '');
});

test('el comprobante sin fecha abre el diálogo de edición con su pago exacto', () => {
  const app = setup([]);
  app.context.overview = {
    snapshot: [{ id: 1, nombre: 'Ana' }],
    paymentsByNeighbor: new Map([['1', [
      { id: 12, comprobante: '008', fecha: null, monto: 1000, aplicaciones: [{ mes: '2025-01-01', monto: 1000 }] },
      { id: 13, comprobante: '008', fecha: '2025-02-01', monto: 500, aplicaciones: [{ mes: '2025-01-01', monto: 500 }] }
    ]]])
  };
  runInContext('session = {}; historyOverviewPayments = overview', app.context);
  app.document.querySelector('#history-overview-year').value = '2025';
  runInContext('renderHistoryOverview()', app.context);
  const entries = app.document.querySelector('#history-overview-rows').children[0].children[1].children;
  assert.equal(typeof entries[0].children[0].listeners.click, 'function');
  assert.equal(entries[1].children[0].listeners.click, undefined);
  entries[0].children[0].listeners.click();
  assert.equal(app.document.querySelector('#receipt-date-dialog').open, true);
  assert.match(app.document.querySelector('#receipt-date-description').textContent, /008.*Ana.*#12/);
  assert.equal(runInContext('editingReceiptDate.pago.id', app.context), 12);
});

test('pagos por mes usa fecha del pago y suma una sola vez, omitiendo anulados y sin fecha', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Luis' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1 ? [
    { id: 1, comprobante: '001', fecha: '2025-04-03', monto: 9000, aplicaciones: [{ mes: '2024-01-01' }, { mes: '2024-02-01' }] },
    { id: 2, comprobante: '2', fecha: '2025-04-04', monto: 600, anulado_en: '2025-05-01', aplicaciones: [] },
    { id: 3, comprobante: '3', fecha: null, monto: 1000, aplicaciones: [{ mes: '2025-04-01' }] },
    { id: 4, comprobante: '4', fecha: '2025-05-01', monto: 700, aplicaciones: [] }
  ] : [{ id: 5, comprobante: null, fecha: '2025-04-02', monto: 500, aplicaciones: [] }];
  runInContext('session = {}; neighbors = neighborList; rpc = mockRpc', app.context);
  await runInContext('openMonthlyPayments()', app.context);
  const form = app.document.querySelector('#monthly-payments-form');
  form.elements.anio.value = '2025';
  form.elements.mes.value = '04';
  runInContext('renderMonthlyPayments()', app.context);
  assert.equal(app.document.querySelector('#monthly-payments-status').textContent, '2 pagos. Total de ingresos: $9.500.');
  assert.deepEqual(Array.from(runInContext("monthlyPaymentRows('2025','04')", app.context), x => x.pago.id), [5, 1]);
  form.elements.mes.value = '06';
  runInContext('renderMonthlyPayments()', app.context);
  assert.equal(app.document.querySelector('#monthly-payments-status').textContent, '0 pagos. Total de ingresos: $0.');
});

test('cerrar el informe mensual descarta una carga pendiente', async () => {
  const app = setup([]);
  let resolve;
  app.context.mockRpc = () => new Promise(done => { resolve = done; });
  runInContext('session = {}; rpc = mockRpc', app.context);
  const loading = runInContext('openMonthlyPayments()', app.context);
  runInContext('clearMonthlyPayments()', app.context);
  resolve([{ id: 1, fecha: '2025-04-01', monto: 1000 }]);
  await loading;
  assert.equal(runInContext('monthlyPayments', app.context), null);
});

test('la carga general limita consultas, ignora respuestas antiguas y permite reintentar', async () => {
  const app = setup([]);
  app.context.neighborList = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, nombre: `Vecino ${i + 1}` }));
  const pending = [];
  app.context.mockRpc = (_, args) => new Promise((resolve, reject) => pending.push({ id: args.p_vecino, resolve, reject }));
  runInContext('neighbors = neighborList; session = {}; rpc = mockRpc', app.context);
  const first = runInContext('loadHistoryOverview()', app.context);
  assert.equal(pending.length, 6);
  pending[0].resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 7);
  runInContext('clearHistoryOverview()', app.context);
  for (const request of pending) request.resolve([]);
  await first;
  assert.equal(app.document.querySelector('#history-overview-rows').children.length, 0);
  const second = runInContext('loadHistoryOverview()', app.context);
  pending[7].reject(new Error('Conexión perdida'));
  await second;
  assert.match(app.document.querySelector('#history-overview-status').textContent, /Conexión perdida/);
  assert.equal(app.document.querySelector('#history-overview-retry').hidden, false);
  const third = runInContext('loadHistoryOverview()', app.context);
  for (let i = 13; i < 19; i++) pending[i].resolve([]);
  await new Promise(resolve => setImmediate(resolve));
  for (const request of pending.slice(19)) request.resolve([]);
  await third;
  assert.equal(app.document.querySelector('#history-overview-rows').children.length, 8);
  assert.equal(app.document.querySelector('#history-overview-retry').hidden, true);
});

test('busca comprobantes entre todos los vecinos y años, incluidos los anulados', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Pedro' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1 ? [
    { id: 1, comprobante: 'AB-123', fecha: null, monto: 1000, aplicaciones: [{ mes: '2021-01-01', monto: 1000 }] },
    { id: 2, comprobante: null, fecha: null, monto: 1000, aplicaciones: [] }
  ] : [
    { id: 3, comprobante: 'ab-123', fecha: '2025-03-04', monto: 500, anulado_en: '2025-04-01', motivo_anulacion: 'Error', aplicaciones: [] }
  ];
  runInContext("neighbors = neighborList; session = {}; rpc = mockRpc; historyReceiptQuery = 'Ab-12'", app.context);
  await runInContext('loadHistoryReceipt()', app.context);
  const rows = app.document.querySelector('#payments').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, 'Ana');
  assert.equal(rows[0].children[1].textContent, '');
  assert.equal(rows[0].children[2].textContent, 'AB-123');
  assert.equal(rows[1].children[0].textContent, 'Pedro');
  assert.equal(rows[1].children[5].textContent, 'Anulado: Error');
  assert.equal(rows[1].children[6].children.length, 0);
  assert.match(app.document.querySelector('#history-status').textContent, /2 pagos encontrados/);
  runInContext("historyReceiptQuery = 'sin coincidencia'", app.context);
  await runInContext('loadHistoryReceipt()', app.context);
  assert.equal(app.document.querySelector('#payments').children.length, 0);
  assert.match(app.document.querySelector('#history-status').textContent, /No se encontraron pagos/);
});

test('descarta respuestas antiguas y muestra errores al buscar comprobantes', async () => {
  const app = setup([]);
  let resolveFirst;
  app.context.mockRpc = () => new Promise(resolve => { resolveFirst = resolve; });
  runInContext("session = {}; rpc = mockRpc; historyReceiptQuery = '123'", app.context);
  const first = runInContext('loadHistoryReceipt()', app.context);
  runInContext('historyVersion++', app.context);
  resolveFirst([{ comprobante: '123', monto: 1000, aplicaciones: [] }]);
  await first;
  assert.equal(app.document.querySelector('#payments').children.length, 0);
  app.context.mockFailure = async () => { throw new Error('Conexión perdida'); };
  runInContext('rpc = mockFailure', app.context);
  await runInContext('loadHistoryReceipt()', app.context);
  assert.match(app.document.querySelector('#history-status').textContent, /Conexión perdida/);
  assert.equal(app.document.querySelector('#payments').children.length, 0);
});

test('la búsqueda para modificar distingue comprobantes repetidos y pagos anulados', async () => {
  const app = setup([]);
  app.context.neighborList = [{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Pedro' }];
  app.context.mockRpc = async (_, args) => args.p_vecino === 1
    ? [{ id: 10, comprobante: '123', fecha: null, monto: 1000, aplicaciones: [] }]
    : [{ id: 11, comprobante: '123', fecha: '2025-01-02', monto: 2000, anulado_en: '2025-02-01', aplicaciones: [] }];
  runInContext("neighbors = neighborList; session = {}; rpc = mockRpc; paymentEditQuery = '123'", app.context);
  await runInContext('searchPaymentEdit()', app.context);
  const results = app.document.querySelector('#payment-edit-results').children;
  assert.equal(results.length, 2);
  assert.match(results[0].children[0].textContent, /Ana.*Pago #10/);
  assert.equal(results[0].children.length, 2);
  assert.match(results[1].children[0].textContent, /Pedro.*Pago #11.*Anulado/);
  assert.equal(results[1].children.length, 1);
});

test('el portal del vecino deja en blanco las fechas ausentes y conserva las registradas', async () => {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    createElement() { return new Element(); }
  };
  const context = createContext({ document, Option: Element });
  runInContext(readFileSync(new URL('../vista-cuotas.js', import.meta.url), 'utf8'), context);
  runInContext(readFileSync(new URL('../vecino.js', import.meta.url), 'utf8'), context);
  context.testData = {
    anio_inicio: 2024, anio_actual: 2025, mes_actual: '2025-03-01', vecino: { nombre: 'Vecino' },
    configuracion_completa: true, deuda_hasta_hoy: 500,
    cuotas: [
      { mes: '2019-12-01', monto: 0, pagado: 500, comprobantes: ['100'], no_cobrado: true },
      { mes: '2020-01-01', monto: 0, pagado: 0, no_cobrado: true },
      { mes: '2024-12-01', monto: 1000, pagado: 1000, comprobantes: ['411'] },
      { mes: '2025-01-01', monto: 1000, pagado: 500, comprobantes: ['433', '434'] },
      { mes: '2025-02-01', monto: 1000, pagado: 0 },
      { mes: '2025-03-01', monto: null, pagado: 0 }
    ],
    pagos: [
      { fecha: null, comprobante: '1', monto: 1000, aplicaciones: [] },
      { fecha: '2025-03-04', comprobante: '2', monto: 1000, aplicaciones: [] }
    ]
  };
  runInContext('session = {}; request = async () => testData', context);
  await runInContext('loadYear(2025, session)', context);
  const rows = document.querySelector('#payments').children;
  assert.equal(rows[0].children[0].textContent, '');
  assert.equal(rows[1].children[0].textContent, '04/03/2025');
  assert.equal(context.testData.pagos[0].fecha, null);
  const years = document.querySelector('#dues').children;
  assert.deepEqual(years.map(year => year.dataset.year), ['2025', '2024', '2020', '2019']);
  assert.equal(years[0].children[0].textContent, '2025');
  assert.equal(years[2].children[0].textContent, '2020 (Sin Cobro por Pandemia Acuerdo a asamblea)');
  assert.equal(years[3].children[0].textContent, '2019 (Sin Cobro por Pandemia Acuerdo a asamblea)');
  const months = years[0].children[1].children;
  assert.equal(months[0].children[1].textContent, 'N.º 433, 434');
  assert.equal(months[0].children[2].textContent, 'Debe $500');
  assert.equal(months[0].children[3].textContent, 'Abonado $500');
  assert.equal(months[0].className, 'dues-month overdue');
  assert.equal(months[1].children[1].textContent, 'Debe $1.000');
  assert.equal(months[1].className, 'dues-month overdue');
  assert.equal(months[2].children[1].textContent, 'Sin configurar');
  assert.equal(months[2].className, 'dues-month unconfigured');
  const previousYearPaidMonth = years[1].children[1].children[0];
  assert.equal(previousYearPaidMonth.children[1].textContent, 'N.º 411');
  assert.equal(previousYearPaidMonth.children[2].textContent, 'Pagada');
  const pandemicMonth = years[3].children[1].children[0];
  assert.equal(pandemicMonth.className, 'dues-month not-charged');
  assert.equal(pandemicMonth.children[1].textContent, 'N.º 100');
  assert.equal(pandemicMonth.children[2].textContent, 'No cobrado');
  assert.equal(pandemicMonth.children[3].textContent, 'Pagado $500');
});
