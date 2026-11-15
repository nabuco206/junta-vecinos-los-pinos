import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.value = '';
    this.textContent = '';
    this.elements = { anio: {}, fecha: {} };
  }
  addEventListener() {}
  add(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

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
    ['Fecha desconocida', '10', 'Enero–Diciembre: $1.000 por mes', '$12.000', 'Registrado'],
    ['02/02/2024', '10', 'Enero: $500; Marzo: $500; Abril–Mayo: $1.000 por mes', '$3.000', 'Registrado'],
    ['01/03/2024', '11', 'Enero: $1.000', '$1.000', 'Anulado: Error']
  ]);
  assert.equal(app.status(), 'Pagos de Vecino aplicados a 2024: $15.000 vigentes.');
  app.document.querySelector('#history-year-select').value = '2025';
  app.render();
  assert.deepEqual(app.rows(), [['Fecha desconocida', '10', 'Enero: $1.000', '$1.000', 'Registrado']]);
  assert.equal(app.status(), 'Pagos de Vecino aplicados a 2025: $1.000 vigentes.');
});

test('muestra un año sin pagos sin confundirlo con deuda', () => {
  const app = setup([{ fecha: null, comprobante: '1', aplicaciones: [{ mes: '2023-01-01', monto: 1000 }] }]);
  app.render();
  assert.deepEqual(app.rows(), []);
  assert.equal(app.status(), 'No hay pagos aplicados a 2024 para Vecino. Un mes sin pagos no implica necesariamente deuda.');
});

test('la vista general muestra cada comprobante vigente en sus meses y distingue fechas desconocidas', () => {
  const app = setup([]);
  app.context.overview = {
    snapshot: [{ id: 1, nombre: 'Vecino 1' }, { id: 2, nombre: 'Vecino 2', no_paga_cuota: true }],
    paymentsByNeighbor: new Map([
      ['1', [
        { comprobante: '433', fecha: '2025-02-03', aplicaciones: [{ mes: '2025-01-01' }, { mes: '2025-02-01' }, { mes: '2024-01-01' }] },
        { comprobante: '123', fecha: null, aplicaciones: [{ mes: '2025-01-01' }] },
        { comprobante: 'anulado', fecha: '2025-01-01', anulado_en: '2025-03-01', aplicaciones: [{ mes: '2025-01-01' }] }
      ]],
      ['2', [{ comprobante: null, fecha: null, aplicaciones: [{ mes: '2025-12-01' }] }]]
    ])
  };
  runInContext('historyOverviewPayments = overview', app.context);
  app.document.querySelector('#history-overview-year').value = '2025';
  runInContext('renderHistoryOverview()', app.context);
  const rows = app.document.querySelector('#history-overview-rows').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.length, 13);
  assert.equal(rows[0].children[0].textContent, 'Vecino 1');
  assert.deepEqual(rows[0].children[1].children.map(entry => entry.children.map(item => item.textContent)), [
    ['433', '03/02/2025'], ['123', 'Fecha desconocida']
  ]);
  assert.deepEqual(rows[0].children[2].children[0].children.map(item => item.textContent), ['433', '03/02/2025']);
  assert.equal(rows[0].children[3].children.length, 0);
  assert.equal(rows[1].children[0].children[0].textContent, 'No paga cuota');
  assert.deepEqual(rows[1].children[12].children[0].children.map(item => item.textContent), ['Sin comprobante', 'Fecha desconocida']);
  app.document.querySelector('#history-overview-year').value = '2024';
  runInContext('renderHistoryOverview()', app.context);
  const updated = app.document.querySelector('#history-overview-rows').children;
  assert.equal(updated[0].children[1].children[0].children[0].textContent, '433');
  assert.equal(updated[0].children[2].children.length, 0);
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
