'use strict';

function mostrarVistaCuotas(data, elements) {
  const money = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const exento = data.vecino.no_paga_cuota;
  elements.status.textContent = exento ? 'Estado: No paga cuota' : data.configuracion_completa
    ? data.deuda_hasta_hoy === 0 ? 'Estado: Al día' : 'Estado: Pendiente'
    : 'Estado: Pendiente · Hay cuotas anuales sin monto configurado. Contacta a la directiva.';
  elements.status.classList.toggle('overdue', !data.configuracion_completa || data.deuda_hasta_hoy > 0);
  elements.balance.textContent = exento ? 'Estás exento del pago de cuotas.' : data.configuracion_completa
    ? data.deuda_hasta_hoy === 0
      ? 'No tienes cuotas pendientes hasta el mes actual.'
      : `Saldo pendiente hasta ${monthNames[Number(data.mes_actual.slice(5, 7)) - 1]} ${data.mes_actual.slice(0, 4)}: ${money.format(data.deuda_hasta_hoy)}.`
    : 'No es posible calcular el saldo completo mientras haya cuotas anuales sin configurar.';

  elements.dues.replaceChildren();
  const duesByYear = new Map();
  for (const due of data.cuotas) {
    const year = due.mes.slice(0, 4);
    if (!duesByYear.has(year)) duesByYear.set(year, []);
    duesByYear.get(year).push(due);
  }
  for (const [year, yearDues] of [...duesByYear].reverse()) {
    const yearSection = document.createElement('section');
    yearSection.className = 'dues-year';
    yearSection.dataset.year = year;
    const heading = document.createElement('h3');
    heading.textContent = ['2019', '2020'].includes(year) && yearDues.some(due => due.no_cobrado)
      ? `${year} (Sin Cobro por Pandemia Acuerdo a asamblea)`
      : year;
    const monthGrid = document.createElement('div');
    monthGrid.className = 'dues-months';
    yearSection.append(heading, monthGrid);
    elements.dues.append(yearSection);

    for (const due of yearDues) {
      const month = document.createElement('article');
      month.className = 'dues-month';
      const balance = due.monto === null ? null : Math.max(due.monto - due.pagado, 0);
      const monthName = document.createElement('strong');
      monthName.textContent = monthNames[Number(due.mes.slice(5, 7)) - 1];
      month.append(monthName);
      const comprobantes = Array.isArray(due.comprobantes) ? due.comprobantes.filter(Boolean) : [];
      if (comprobantes.length) {
        const receipt = document.createElement('small');
        receipt.className = 'dues-receipts';
        receipt.textContent = `N.º ${comprobantes.join(', ')}`;
        month.append(receipt);
      }
      const amount = document.createElement('span');
      const detail = document.createElement('small');
      if (due.no_cobrado) {
        month.classList.add('not-charged');
        amount.textContent = 'No cobrado';
        detail.textContent = due.pagado > 0 ? `Pagado ${money.format(due.pagado)}` : '';
      } else if (exento) {
        amount.textContent = 'Exento';
      } else if (balance === null) {
        month.classList.add('unconfigured');
        amount.textContent = 'Sin configurar';
      } else if (balance > 0) {
        month.classList.add('overdue');
        amount.textContent = `Debe ${money.format(balance)}`;
        detail.textContent = due.pagado > 0 ? `Abonado ${money.format(due.pagado)}` : 'Pendiente';
      } else {
        month.classList.add('paid');
        amount.textContent = 'Pagada';
        detail.textContent = money.format(due.pagado);
      }
      month.append(amount);
      if (detail.textContent) month.append(detail);
      monthGrid.append(month);
    }
  }
}
