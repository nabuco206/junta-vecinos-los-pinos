import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crearArchivo } from '../src/exportar-vecinos.js';

async function leerArchivo(vecinos) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await crearArchivo(vecinos));
  return libro.getWorksheet('Vecinos');
}

test('exporta datos como texto seguro y conserva el mes de inicio', async () => {
  const hoja = await leerArchivo([
    { id: 1, nombre: 'Ángela, "Sol"', rut: '12.345.678-K', inicio: '2014-02-01' },
    { id: 2, nombre: '=1+1', rut: '1-9', inicio: '2026-03-01' }
  ]);
  assert.deepEqual(hoja.getRow(1).values.slice(1), ['ID', 'Nombre', 'RUT', 'Inicio de cobro (mes/año)']);
  assert.deepEqual(hoja.getRow(2).values.slice(1), [1, 'Ángela, "Sol"', '12.345.678-K', '02/2014']);
  assert.equal(hoja.getCell('B3').value, '=1+1');
  assert.equal(hoja.getCell('B3').formula, undefined);
  assert.equal(hoja.getCell('D3').value, '03/2026');
});

test('genera encabezados aun sin vecinos', async () => {
  const hoja = await leerArchivo([]);
  assert.equal(hoja.rowCount, 1);
  assert.equal(hoja.getCell('A1').value, 'ID');
});
