import ExcelJS from 'exceljs/dist/exceljs.min.js';

export async function crearArchivo(vecinos) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Vecinos');
  hoja.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nombre', key: 'nombre', width: 40 },
    { header: 'RUT', key: 'rut', width: 18 },
    { header: 'Inicio de cobro (mes/año)', key: 'inicio', width: 25 },
    { header: 'Cuota', key: 'cuota', width: 18 }
  ];
  hoja.getRow(1).font = { bold: true };
  for (const vecino of vecinos) {
    const [anio, mes] = vecino.inicio.split('-');
    hoja.addRow({ id: vecino.id, nombre: vecino.nombre, rut: vecino.rut, inicio: `${mes}/${anio}`, cuota: vecino.no_paga_cuota ? 'No paga cuota' : 'Paga cuota' });
  }
  return libro.xlsx.writeBuffer();
}
