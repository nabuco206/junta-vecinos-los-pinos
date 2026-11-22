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

export async function crearArchivoCuotas(datos, anioActual = new Date().getFullYear()) {
  if (!Array.isArray(datos?.vecinos) || !Array.isArray(datos?.pagos)) {
    throw new Error('La respuesta de cuotas está incompleta.');
  }
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('CUOTAS UNIVERSAL', { views: [{ state: 'frozen', ySplit: 1 }] });
  const detalle = libro.addWorksheet('Detalle de pagos', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: '', width: 4 }, { header: 'Nº SOCIO', width: 9.3 },
    { header: 'NOMBRE', width: 39 }, { header: 'RUT', width: 37.4 },
    { header: 'INGRESO', width: 28.1 }, { header: 'AÑO', width: 21.3 },
    ...['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
      .map(header => ({ header, width: 11.3 })),
    { header: 'OBSERVACION', width: 27.1 }
  ];
  detalle.columns = [
    { header: 'Vecino', width: 35 }, { header: 'RUT', width: 18 },
    { header: 'ID pago', width: 12 }, { header: 'Comprobante', width: 20 },
    { header: 'Fecha pago', width: 16 }, { header: 'Monto pago', width: 16 },
    { header: 'Estado', width: 14 }, { header: 'Mes aplicado', width: 16 },
    { header: 'Monto aplicado', width: 18 }
  ];
  hoja.getRow(1).height = 21.75;
  detalle.getRow(1).font = { bold: true };
  const vecinos = new Map(datos.vecinos.map(v => [String(v.id), v]));
  const pagosPorVecino = new Map();
  for (const pago of datos.pagos) {
    const vecino = vecinos.get(String(pago.vecino_id));
    if (!vecino) throw new Error('Hay un pago sin vecino en la respuesta.');
    if (!Array.isArray(pago.aplicaciones)) throw new Error('Faltan las aplicaciones de un pago.');
    const pagos = pagosPorVecino.get(String(vecino.id)) || [];
    pagos.push(pago);
    pagosPorVecino.set(String(vecino.id), pagos);
  }
  for (const vecino of datos.vecinos) {
    const rut = String(vecino.rut ?? '').trim();
    if (!rut || ['NO', '#N/A'].includes(rut.toUpperCase())) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vecino.inicio)) {
      throw new Error(`El inicio de ${vecino.nombre} no es válido.`);
    }
    const inicio = Number(vecino.inicio.slice(0, 4));
    const pagos = pagosPorVecino.get(String(vecino.id)) || [];
    const meses = new Map();
    let primerAnio = inicio;
    let ultimoAnio = Math.max(inicio, anioActual);
    for (const pago of pagos) {
      const aplicaciones = pago.aplicaciones.length ? pago.aplicaciones : [null];
      for (const aplicacion of aplicaciones) {
        if (aplicacion && !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(aplicacion.mes)) {
          throw new Error(`El pago ${pago.id} tiene un mes inválido.`);
        }
        detalle.addRow([
          vecino.nombre, rut, pago.id, pago.comprobante || '', pago.fecha || '',
          pago.monto, pago.anulado_en ? 'Anulado' : 'Registrado',
          aplicacion?.mes || '', aplicacion?.monto ?? ''
        ]);
        if (!aplicacion || pago.anulado_en) continue;
        const anio = Number(aplicacion.mes.slice(0, 4));
        primerAnio = Math.min(primerAnio, anio);
        ultimoAnio = Math.max(ultimoAnio, anio);
        const lista = meses.get(aplicacion.mes) || [];
        lista.push(pago.comprobante || 'Sin comprobante');
        meses.set(aplicacion.mes, lista);
      }
    }
    if (primerAnio < 2000 || ultimoAnio > 2100) throw new Error('Hay años fuera del rango permitido.');
    for (let anio = primerAnio; anio <= ultimoAnio; anio++) {
      const valoresMeses = Array.from({ length: 12 }, (_, i) =>
        (meses.get(`${anio}-${String(i + 1).padStart(2, '0')}-01`) || [])
      );
      const observacion = [
        vecino.no_paga_cuota ? 'No paga cuota' : '',
        [2019, 2020].includes(anio) ? 'Año sin cobro' : ''
      ].filter(Boolean).join('; ');
      const [a, m] = vecino.inicio.split('-');
      const row = hoja.addRow(['', vecino.numero_socio ?? '', vecino.nombre, rut.replace(/,/g, '.'),
        `${m}/${a}`, anio, ...valoresMeses.map(lista => {
          if (lista.length === 1 && /^(0|[1-9]\d*)$/.test(lista[0]) && Number.isSafeInteger(Number(lista[0]))) {
            return Number(lista[0]);
          }
          return lista.join(' / ');
        }), observacion]);
      const monthLines = Math.max(1, ...valoresMeses.map(lista => Math.ceil(lista.join(' / ').length / 11)));
      row.height = 21 * monthLines;
    }
  }
  const border = { style: 'thin', color: { argb: 'FF000000' } };
  hoja.eachRow(row => {
    for (let column = 2; column <= 19; column++) {
      const cell = row.getCell(column);
      cell.font = { name: 'Calibri', size: column === 2 ? 12 : 16, bold: row.number === 1 };
      cell.border = { top: border, bottom: border, left: border, right: border };
      cell.alignment = { vertical: 'middle', horizontal: [2, 6].includes(column) ? 'center' : 'left', wrapText: true };
    }
  });
  return libro.xlsx.writeBuffer();
}
