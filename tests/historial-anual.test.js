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
  append(child) { this.children.push(child); }
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
  return { document, render, rows, status };
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
