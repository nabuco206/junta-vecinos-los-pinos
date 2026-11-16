import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

class Element {
  constructor(text = '', value = '') {
    this.children = [];
    this.dataset = {};
    this.value = value;
    this.textContent = text;
    this.elements = { anio: {}, fecha: {} };
    this.className = '';
    this.classList = {
      add: name => { this.className = `${this.className} ${name}`.trim(); },
      toggle() {}
    };
  }
  addEventListener() {}
  setAttribute() {}
  add(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

test('el selector de Pagos por Año contiene exclusivamente los años 2014 a 2027', () => {
  const app = setup([]);
  const options = app.document.querySelector('#history-overview-year').children;
  assert.deepEqual(options.map(option => option.value), Array.from({ length: 14 }, (_, i) => String(2027 - i)));
  const selected = Number(app.document.querySelector('#history-overview-year').value);
  assert.ok(selected >= 2014 && selected <= 2027);
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
  assert.deepEqual(rows.map(row => row.children.map(item => item.textContent)), [
    ['2', 'Luis', '04/03/2025', '$500', 'Anulado'],
    ['406', 'Ana', '', '$1.000', 'Registrado'],
    ['406', 'Luis', '', '$700', 'Registrado']
  ]);
  assert.equal(app.document.querySelector('#export-receipts').disabled, false);
  app.context.mockRpc = async () => { throw new Error('Conexión perdida'); };
  runInContext('rpc = mockRpc', app.context);
  await runInContext('loadReceipts()', app.context);
  assert.equal(app.document.querySelector('#receipts-list').children.length, 0);
  assert.match(app.document.querySelector('#receipts-status').textContent, /Conexión perdida/);
  assert.equal(app.document.querySelector('#export-receipts').disabled, true);
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

function setup(payments, year = '2024') {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    createElement() { return new Element(); }
  };
  const context = createContext({ document, Option: Element });
  runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
  context.testPayments = payments;
  runInContext("neighbors = [{ id: 1, nombre: 'Vecino' }]; historyYearPayments = testPayments", context);
  document.querySelector('#history-year-neighbor').value = '1';
  document.querySelector('#history-year-select').value = year;
  const render = () => runInContext('renderHistoryYear()', context);
  const rows = () => document.querySelector('#history-year-months').children.map(row => row.children.map(cell => cell.textContent));
  const status = () => document.querySelector('#history-year-status').textContent;
  return { context, document, render, rows, status };
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

test('agrupa meses consecutivos y suma solo aplicaciones vigentes del año', () => {
  const fullYear = Array.from({ length: 12 }, (_, i) => ({ mes: `2024-${String(i + 1).padStart(2, '0')}-01`, monto: 1000 }));
  const app = setup([
    { fecha: null, comprobante: '10', aplicaciones: [...fullYear, { mes: '2025-01-01', monto: 1000 }] },
    { fecha: '2024-02-02', comprobante: '10', aplicaciones: [
      { mes: '2024-01-01', monto: 500 }, { mes: '2024-03-01', monto: 500 },
      { mes: '2024-04-01', monto: 1000 }, { mes: '2024-05-01', monto: 1000 }
    ] },
    { fecha: '2024-03-01', comprobante: '11', anulado_en: '2024-03-02', motivo_anulacion: 'Error', aplicaciones: [
      { mes: '2024-01-01', monto: 1000 }
    ] }
  ]);
  app.render();
  assert.deepEqual(app.rows(), [
    ['', '10', 'Enero–Diciembre: $1.000 por mes', '$12.000', 'Registrado'],
    ['02/02/2024', '10', 'Enero: $500; Marzo: $500; Abril–Mayo: $1.000 por mes', '$3.000', 'Registrado'],
    ['01/03/2024', '11', 'Enero: $1.000', '$1.000', 'Anulado: Error']
  ]);
  assert.equal(app.status(), 'Pagos de Vecino aplicados a 2024: $15.000 vigentes.');
  app.document.querySelector('#history-year-select').value = '2025';
  app.render();
  assert.deepEqual(app.rows(), [['', '10', 'Enero: $1.000', '$1.000', 'Registrado']]);
  assert.equal(app.status(), 'Pagos de Vecino aplicados a 2025: $1.000 vigentes.');
});

test('muestra un año sin pagos sin confundirlo con deuda', () => {
  const app = setup([{ fecha: null, comprobante: '1', aplicaciones: [{ mes: '2023-01-01', monto: 1000 }] }]);
  app.render();
  assert.deepEqual(app.rows(), []);
  assert.equal(app.status(), 'No hay pagos aplicados a 2024 para Vecino. Un mes sin pagos no implica necesariamente deuda.');
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
