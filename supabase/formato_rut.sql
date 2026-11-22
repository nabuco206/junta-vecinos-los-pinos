-- Ejecutar después de validar_rut.sql.
-- Estandariza RUT válidos como 12.345.678-5, también en futuras altas y cambios.
begin;

create or replace function cuotas_privado.rut_formatear(p_rut text) returns text
language plpgsql immutable security definer set search_path = '' as $$
declare
  entrada text;
  normalizado text;
  cuerpo text;
  cuerpo_formateado text := '';
  resultado text;
  i integer;
begin
  if p_rut is null then return null; end if;
  entrada := upper(regexp_replace(replace(btrim(p_rut), ',', '.'), '[[:space:]]', '', 'g'));
  if entrada !~ '^[0-9K.-]+$' then return p_rut; end if;
  normalizado := regexp_replace(entrada, '[.-]', '', 'g');
  if normalizado !~ '^[0-9]{1,8}[0-9K]$' then return p_rut; end if;
  cuerpo := left(normalizado, length(normalizado) - 1);
  if cuerpo::integer = 0 then return p_rut; end if;

  for i in 1..length(cuerpo) loop
    if i > 1 and (length(cuerpo) - i + 1) % 3 = 0 then
      cuerpo_formateado := cuerpo_formateado || '.';
    end if;
    cuerpo_formateado := cuerpo_formateado || substring(cuerpo from i for 1);
  end loop;
  resultado := cuerpo_formateado || '-' || right(normalizado, 1);
  if cuotas_privado.rut_valido(resultado) then return resultado; end if;
  return p_rut;
end;
$$;
revoke all on function cuotas_privado.rut_formatear(text) from public, anon, authenticated;

create or replace function cuotas_privado.verificar_rut_vecino() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.rut is distinct from old.rut then
    new.rut := cuotas_privado.rut_formatear(new.rut);
    if not cuotas_privado.rut_valido(new.rut) then
      raise exception 'Ingresa un RUT válido con su dígito verificador';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function cuotas_privado.verificar_rut_vecino() from public, anon, authenticated;
drop trigger if exists vecinos_validar_rut on cuotas_privado.vecinos;
create trigger vecinos_validar_rut before insert or update of rut on cuotas_privado.vecinos
for each row execute function cuotas_privado.verificar_rut_vecino();

do $regularizar$
declare
  cantidad integer;
  invalidos integer;
begin
  if exists (
    select 1
    from (
      select cuotas_privado.rut_formatear(v.rut) as rut_formateado
      from cuotas_privado.vecinos v
      where cuotas_privado.rut_valido(cuotas_privado.rut_formatear(v.rut))
    ) r
    group by rut_formateado
    having count(*) > 1
  ) then
    raise exception 'Hay RUT repetidos al aplicar el formato estándar; no se modificó ningún registro';
  end if;

  select count(*) into invalidos
  from cuotas_privado.vecinos v
  where not cuotas_privado.rut_valido(cuotas_privado.rut_formatear(v.rut));

  update cuotas_privado.vecinos v
  set rut = cuotas_privado.rut_formatear(v.rut)
  where cuotas_privado.rut_valido(cuotas_privado.rut_formatear(v.rut))
    and v.rut is distinct from cuotas_privado.rut_formatear(v.rut);
  get diagnostics cantidad = row_count;

  raise notice 'RUT formateados: %; RUT inválidos o pendientes, sin cambios: %',
    cantidad, invalidos;
end
$regularizar$;

commit;
