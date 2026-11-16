-- Ejecutar una vez después de registrar vecinos, si la cuota histórica fue siempre $1.000.
begin;

do $$
declare
  v_primer_anio integer;
  v_anio_actual integer := extract(year from current_date)::integer;
begin
  if not exists (
    select 1 from cuotas_privado.aranceles where monto = 1000
  ) then
    raise exception 'No se encontró una cuota de $1.000 registrada; verifica los valores antes de continuar';
  end if;

  select min(extract(year from inicio)::integer)
    into v_primer_anio
    from cuotas_privado.vecinos;

  if v_primer_anio is null or v_primer_anio > v_anio_actual then
    raise notice 'No hay años de cobro que completar';
    return;
  end if;

  insert into cuotas_privado.aranceles(anio, monto)
    select years.anio, 1000
    from generate_series(v_primer_anio, v_anio_actual) as years(anio)
    on conflict (anio) do nothing;
end;
$$;

commit;
