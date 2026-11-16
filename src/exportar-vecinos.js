import ExcelJS from 'exceljs/dist/exceljs.min.js';

export async function crearArchivo(vecinos) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Vecinos');
  hoja.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nombre', key: 'nombre', width: 40 },
    { header: 'RUT', key: 'rut', width: 18 },
    { header: 'Número de socio', key: 'numero_socio', width: 20 },
    { header: 'Inicio de cobro (mes/año)', key: 'inicio', width: 25 },
    { header: 'Cuota', key: 'cuota', width: 18 }
  ];
  hoja.getRow(1).font = { bold: true };
  for (const vecino of vecinos) {
    const [anio, mes] = vecino.inicio.split('-');
    hoja.addRow({ id: vecino.id, nombre: vecino.nombre, rut: vecino.rut, numero_socio: vecino.numero_socio || '', inicio: `${mes}/${anio}`, cuota: vecino.no_paga_cuota ? 'No paga cuota' : 'Paga cuota' });
  }
  return libro.xlsx.writeBuffer();
}

export async function crearArchivoPagosPorAnio(anio, filas) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Pagos por Año', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  hoja.columns = [{ width: 32 }, ...meses.map(() => ({ width: 18 }))];
  hoja.addRow([`Pagos por Año: ${anio}`]);
  hoja.addRow(['Vecino', ...meses]);
  hoja.getRow(1).font = { bold: true, size: 14 };
  hoja.getRow(2).font = { bold: true };
  for (const { neighbor, months } of filas) {
    const nombre = neighbor.no_paga_cuota ? `${neighbor.nombre}\nNo paga cuota` : neighbor.nombre;
    hoja.addRow([nombre, ...months.map(pagos => pagos.map(pago => {
      const comprobante = pago.comprobante || 'Sin comprobante';
      const fecha = pago.fecha ? pago.fecha.split('-').reverse().join('/') : '';
      return fecha ? `${comprobante}\n${fecha}` : comprobante;
    }).join('\n\n'))]);
  }
  hoja.eachRow(row => {
    row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; });
  });
  return libro.xlsx.writeBuffer();
}

export async function crearArchivoComprobantes(filas) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Comprobantes');
  hoja.columns = [
    { header: 'Comprobante', key: 'comprobante', width: 22 },
    { header: 'Vecino', key: 'vecino', width: 40 },
    { header: 'Fecha', key: 'fecha', width: 16 },
    { header: 'Monto', key: 'monto', width: 16 },
    { header: 'Estado', key: 'estado', width: 16 }
  ];
  hoja.getRow(1).font = { bold: true };
  for (const fila of filas) hoja.addRow(fila);
  return libro.xlsx.writeBuffer();
}
