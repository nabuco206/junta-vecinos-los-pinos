import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crearArchivo, crearArchivoPagosPorAnio } from '../src/exportar-vecinos.js';

async function leerArchivo(vecinos) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivo(vecinos));
  return libro.getWorksheet('Vecinos');
}

test('exporta datos como texto seguro y conserva el mes de inicio', async () => {
  const hoja = await leerArchivo([
    { id: 1, nombre: 'Ángela, "Sol"', rut: '12.345.678-K', inicio: '2014-02-01' },
    { id: 2, nombre: '=1+1', rut: '1-9', inicio: '2026-03-01', no_paga_cuota: true }
  ]);
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['ID', 'Nombre', 'RUT', 'Inicio de cobro (mes/año)', 'Cuota']);
  assert.deepEqual(hoja.getRow(2).values.slice(1), [1, 'Ángela, "Sol"', '12.345.678-K', '02/2014', 'Paga cuota']);
  assert.equal(hoja.getCell('B3').value, '=1+1');
  assert.equal(hoja.getCell('B3').formula, undefined);
  assert.equal(hoja.getCell('D3').value, '03/2026');
  assert.equal(hoja.getCell('E3').value, 'No paga cuota');
});

test('genera encabezados aun sin vecinos', async () => {
  const hoja = await leerArchivo([]);
  assert.equal(hoja.rowCount, 1);
  assert.equal(hoja.getCell('A1').value, 'ID');
});

test('exporta el año y los doce meses con comprobantes y fechas como texto', async () => {
  const meses = Array.from({ length: 12 }, () => []);
  meses[0] = [{ comprobante: '=123', fecha: '2025-03-04' }, { comprobante: '456', fecha: null }];
  meses[11] = [{ comprobante: null, fecha: null }];
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivoPagosPorAnio('2025', [
    { neighbor: { nombre: '=Vecino', no_paga_cuota: true }, months: meses },
    { neighbor: { nombre: 'Otro' }, months: Array.from({ length: 12 }, () => []) }
  ]));
  const hoja = libro.getWorksheet('Pagos por Año');
  assert.equal(hoja.getCell('A1').value, 'Pagos por Año: 2025');
  assert.deepEqual(hoja.getRow(2).values.slice(1), ['Vecino', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']);
  assert.equal(hoja.getCell('A3').value, '=Vecino\nNo paga cuota');
  assert.equal(hoja.getCell('A3').formula, undefined);
  assert.equal(hoja.getCell('B3').value, '=123\n04/03/2025\n\n456');
  assert.equal(hoja.getCell('B3').formula, undefined);
  assert.equal(hoja.getCell('C3').value, '');
  assert.equal(hoja.getCell('M3').value, 'Sin comprobante');
  assert.equal(hoja.getCell('A4').value, 'Otro');
});
