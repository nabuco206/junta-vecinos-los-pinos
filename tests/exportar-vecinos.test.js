import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crearArchivo, crearArchivoComprobantes, crearArchivoCuotas, crearArchivoPagosMes, crearInformePagosMes } from '../src/exportar-vecinos.js';

async function leerArchivo(vecinos) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivo(vecinos));
  return libro.getWorksheet('Vecinos');
}

test('exporta datos como texto seguro y conserva el mes de inicio', async () => {
  const hoja = await leerArchivo([
    { id: 1, nombre: 'Ángela, "Sol"', rut: '12.345.678-K', numero_socio: '0012', inicio: '2014-02-01' },
    { id: 2, nombre: '=1+1', rut: '1-9', numero_socio: '20', inicio: '2026-03-01', no_paga_cuota: true }
  ]);
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['ID', 'Nombre', 'RUT', 'Número de socio', 'Inicio de cobro (mes/año)', 'Cuota']);
  assert.deepEqual(hoja.getRow(2).values.slice(1), [1, 'Ángela, "Sol"', '12.345.678-K', '0012', '02/2014', 'Paga cuota']);
  assert.equal(hoja.getCell('B3').value, '=1+1');
  assert.equal(hoja.getCell('B3').formula, undefined);
  assert.equal(hoja.getCell('D3').value, '20');
  assert.equal(hoja.getCell('E3').value, '03/2026');
  assert.equal(hoja.getCell('F3').value, 'No paga cuota');
});

test('genera encabezados aun sin vecinos', async () => {
  const hoja = await leerArchivo([]);
  assert.equal(hoja.rowCount, 1);
  assert.equal(hoja.getCell('A1').value, 'ID');
});

test('exporta comprobantes repetidos como texto y conserva fecha vacía y estado', async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivoComprobantes([
    { comprobante: '00406', vecino: '=Vecino', fecha: '', monto: 1000, estado: 'Registrado' },
    { comprobante: '00406', vecino: 'Otro', fecha: '03/02/2025', monto: 500, estado: 'Anulado' }
  ]));
  const hoja = libro.getWorksheet('Comprobantes');
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['Comprobante', 'Vecino', 'Fecha', 'Monto', 'Estado']);
  assert.deepEqual(hoja.getRow(2).values.slice(1), ['00406', '=Vecino', '', 1000, 'Registrado']);
  assert.equal(hoja.getCell('B2').formula, undefined);
  assert.deepEqual(hoja.getRow(3).values.slice(1), ['00406', 'Otro', '03/02/2025', 500, 'Anulado']);
});

test('exporta pagos mensuales con importe total y mantiene comprobantes como texto', async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivoPagosMes([
    { fecha: '02/04/2025', comprobante: '001', vecino: '=Ana', monto: 9000 },
    { fecha: '03/04/2025', comprobante: '', vecino: 'Luis', monto: 500 }
  ]));
  const hoja = libro.getWorksheet('Pagos por mes');
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['Fecha', 'Comprobante', 'Nombre de socio', 'Monto']);
  assert.deepEqual(hoja.getRow(2).values.slice(1), ['02/04/2025', '001', '=Ana', 9000]);
  assert.equal(hoja.getCell('C2').formula, undefined);
  assert.equal(hoja.getCell('C4').value, 'Total de ingresos');
  assert.equal(hoja.getCell('D4').value, 9500);
  const vacio = new ExcelJS.Workbook();
  await vacio.xlsx.load(await crearArchivoPagosMes([]));
  assert.equal(vacio.getWorksheet('Pagos por mes').getCell('D2').value, 0);
});

test('genera informe imprimible por folio, con total y sin perder pagos', async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearInformePagosMes([
    { fecha: '03/01/2026', comprobante: '520', vecino: '=Ana', monto: 12000 },
    { fecha: '02/01/2026', comprobante: '002', vecino: 'Luis', monto: 500 },
    { fecha: '04/01/2026', comprobante: '', vecino: 'Pedro', monto: 1000 }
  ], '2026', '01'));
  const hoja = libro.getWorksheet('Informe tesorería');
  assert.equal(hoja.getCell('A1').value, 'JUNTA DE VECINOS Nº 34');
  assert.equal(hoja.getCell('C1').value, 'TESORERÍA ENERO 2026');
  assert.deepEqual(hoja.getRow(4).values.slice(1), ['FECHA', 'FOLIO', 'NOMBRE SOCIO', 'INGRESO']);
  assert.deepEqual(hoja.getRow(5).values.slice(1), ['02-01-2026', '002', 'Luis', 500]);
  assert.deepEqual(hoja.getRow(6).values.slice(1), ['03-01-2026', '520', '=Ana', 12000]);
  assert.equal(hoja.getCell('C6').formula, undefined);
  assert.equal(hoja.getCell('C7').value, 'Pedro');
  assert.equal(hoja.getCell('C37').value, 'TOTAL');
  assert.equal(hoja.getCell('D37').value, 13500);
  assert.equal(hoja.getCell('A36').border.bottom.style, 'thin');
  assert.equal(hoja.pageSetup.printArea, 'A1:D37');
  assert.equal(hoja.pageSetup.fitToWidth, 1);
  const muchos = new ExcelJS.Workbook();
  await muchos.xlsx.load(await crearInformePagosMes(
    Array.from({ length: 40 }, (_, i) => ({ fecha: '01/01/2026', comprobante: String(i), vecino: 'Vecino', monto: 1000 })),
    '2026', '01'));
  assert.equal(muchos.getWorksheet('Informe tesorería').getCell('D45').value, 40000);
  await assert.rejects(() => crearInformePagosMes([], '2026', '13'), /válidos/);
});

test('exporta cuotas por años consecutivos y conserva detalles parciales y anulados', async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivoCuotas({
    vecinos: [
      { id: 1, nombre: '=Ana', rut: '1,234.567-8', numero_socio: '001', inicio: '2018-03-01' },
      { id: 2, nombre: 'Sin RUT', rut: '', inicio: '2018-01-01' }
    ],
    pagos: [
      { id: 1, vecino_id: 1, comprobante: '001', fecha: null, monto: 400, aplicaciones: [{ mes: '2018-03-01', monto: 400 }] },
      { id: 2, vecino_id: 1, comprobante: '002', fecha: '2021-01-01', monto: 600, aplicaciones: [{ mes: '2018-03-01', monto: 600 }, { mes: '2022-01-01', monto: 100 }] },
      { id: 3, vecino_id: 1, comprobante: '003', monto: 500, anulado_en: '2022-01-01', aplicaciones: [{ mes: '2018-03-01', monto: 500 }] },
      { id: 4, vecino_id: 1, comprobante: null, monto: 200, aplicaciones: [] },
      { id: 5, vecino_id: 2, comprobante: '999', monto: 500, aplicaciones: [] },
      { id: 6, vecino_id: 1, comprobante: '456', monto: 1000, aplicaciones: [{ mes: '2022-02-01', monto: 1000 }] }
    ]
  }, 2021));
  const hoja = libro.getWorksheet('CUOTAS UNIVERSAL');
  assert.deepEqual(hoja.getRow(1).values.slice(2), ['Nº SOCIO', 'NOMBRE', 'RUT', 'INGRESO', 'AÑO', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC', 'OBSERVACION']);
  assert.deepEqual(hoja.getRows(2, 5).map(row => row.getCell(6).value), [2018, 2019, 2020, 2021, 2022]);
  assert.equal(hoja.getCell('C2').value, '=Ana');
  assert.equal(hoja.getCell('C2').formula, undefined);
  assert.equal(hoja.getCell('D2').value, '1.234.567-8');
  assert.equal(hoja.getCell('I2').value, '001 / 002');
  assert.equal(hoja.getCell('S3').value, 'Año sin cobro');
  assert.equal(hoja.getCell('G6').value, '002');
  assert.equal(hoja.getCell('H6').value, 456);
  assert.equal(hoja.getColumn(3).width, 39);
  assert.equal(hoja.getCell('C1').font.bold, true);
  assert.equal(hoja.getCell('G2').border.left.style, 'thin');
  const detalle = libro.getWorksheet('Detalle de pagos');
  assert.equal(detalle.rowCount, 7);
  assert.equal(detalle.getCell('G5').value, 'Anulado');
  assert.equal(detalle.getCell('I2').value, 400);
  assert.equal(detalle.getCell('I3').value, 600);
  assert.equal(detalle.getCell('H6').value, '');
});

test('rechaza datos incompletos en vez de exportar un historial parcial', async () => {
  await assert.rejects(() => crearArchivoCuotas({ vecinos: [], pagos: [{ vecino_id: 5, aplicaciones: [] }] }, 2025), /sin vecino/);
  await assert.rejects(() => crearArchivoCuotas({ vecinos: [{ id: 1, rut: '1-9', inicio: '2025-01-01' }], pagos: [{ vecino_id: 1 }] }, 2025), /aplicaciones/);
});
