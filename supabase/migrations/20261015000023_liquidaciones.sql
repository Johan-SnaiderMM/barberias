-- =====================================================================
-- BARBERÍAS · 0023 · LIQUIDAR COMISIONES (tarea 3.5 · SPEC F7)
--
--   liquidar_comisiones(...)             le paga a un barbero todo lo que se le debe hasta un día.
--   anular_liquidacion(id, motivo)       deshace una liquidación: sus cobros vuelven a quedar pendientes.
--   obtener_resumen_comisiones(d, h)     por barbero: lo generado en el periodo y lo que falta por pagarle.
--   obtener_comisiones_de_barbero(...)   los cobros pendientes de un barbero y sus liquidaciones.
--   obtener_liquidacion(id)              una liquidación con los cobros que pagó.
--   obtener_cobro(id)                    (redefinida) ahora dice si el cobro ya está liquidado.
--
-- REGLAS
--   * Lo que se le debe a un barbero por un cobro es su comisión más la parte de la propina que es suya: las dos se
--     guardaron al cobrar (0022), así que liquidar no recalcula nada.
--   * Liquidar paga TODO lo pendiente hasta un día, no solo el periodo que se esté mirando: nada viejo se olvida y el
--     monto que se ve es el que se paga. Cada cobro entra en UNA sola liquidación vigente (índice único parcial):
--     una liquidación no se puede aplicar dos veces al mismo cobro, ni escribiendo directo en la tabla.
--   * Idempotente: la pantalla crea una clave al abrirse; repetirla devuelve la misma liquidación. Sin nada
--     pendiente no se crea nada.
--   * Se anula con motivo; sus cobros vuelven a estar pendientes y la liquidación queda en el historial. No se borra nada.
--   * Un cobro liquidado no se anula mientras la liquidación esté vigente (si no, al barbero se le pagaría de más).
--   * `fecha` es el día en que se pagó (lo pone fn_jornada): el cierre del día descuenta de la caja lo pagado en efectivo.
--   * Permiso: área "comisiones" para todos los barberos; el barbero (mi_agenda) solo ve lo suyo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create table if not exists public.liquidaciones (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  barbero_id      uuid not null,
  clave           uuid not null,                          -- idempotencia: la crea la pantalla al abrirse
  hasta           date not null,                          -- se pagó todo lo pendiente hasta este día
  medio           text not null check (medio in ('efectivo', 'transferencia')),
  cobros          integer not null check (cobros > 0),    -- cuántos cobros cubre
  comision        integer not null check (comision >= 0),
  propina         integer not null check (propina >= 0),  -- la parte de la propina que era del barbero
  total           integer not null,                       -- lo que se le pagó: comisión + propina
  nota            text check (nota is null or length(btrim(nota)) between 1 and 200),
  fecha           date not null,                          -- el día en que se pagó (lo pone fn_jornada)
  anulada         boolean not null default false,
  anulada_motivo  text,
  anulada_por     uuid references auth.users(id) on delete set null,
  anulada_at      timestamptz,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_liquidaciones_clave unique (barberia_id, clave),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id),
  constraint chk_liquidacion_total check (total = comision + propina),
  constraint chk_liquidacion_anulacion check (
    (anulada = false and anulada_motivo is null and anulada_at is null)
    or (anulada = true and length(btrim(coalesce(anulada_motivo, ''))) > 0 and anulada_at is not null)
  )
);
create index if not exists idx_liquidaciones_barbero on public.liquidaciones (barberia_id, barbero_id, created_at desc);
create index if not exists idx_liquidaciones_fecha on public.liquidaciones (barberia_id, fecha) where not anulada;
comment on table public.liquidaciones is 'Pagos de comisión a un barbero. No se editan ni se borran: se anulan con motivo.';

-- Qué cobros cubre cada liquidación (con lo que valía cada uno al liquidar). `vigente` pasa a false al anular la
-- liquidación; el índice único parcial es la garantía de que un cobro no se liquida dos veces.
create table if not exists public.liquidacion_cobros (
  liquidacion_id  uuid not null,
  cobro_id        uuid not null,
  barberia_id     uuid not null references public.barberias(id),
  comision        integer not null check (comision >= 0),
  propina_barbero integer not null check (propina_barbero >= 0),
  vigente         boolean not null default true,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (liquidacion_id, cobro_id),
  foreign key (barberia_id, liquidacion_id) references public.liquidaciones (barberia_id, id),
  foreign key (barberia_id, cobro_id)       references public.cobros (barberia_id, id)
);
create unique index if not exists ux_liquidacion_cobro_vigente on public.liquidacion_cobros (cobro_id) where vigente;
create index if not exists idx_liquidacion_cobros_cobro on public.liquidacion_cobros (barberia_id, cobro_id);
comment on table public.liquidacion_cobros is 'Los cobros que paga cada liquidación. Un cobro solo está en una liquidación vigente.';

-- ---------------------------------------------------------------------
-- 2. Triggers: nada se edita ni se borra
-- ---------------------------------------------------------------------
-- De una liquidación solo cambia la anulación; una anulada no se reactiva.
create or replace function public.fn_liquidacion_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.barberia_id is distinct from old.barberia_id
     or new.barbero_id is distinct from old.barbero_id
     or new.clave is distinct from old.clave
     or new.hasta is distinct from old.hasta
     or new.medio is distinct from old.medio
     or new.cobros is distinct from old.cobros
     or new.comision is distinct from old.comision
     or new.propina is distinct from old.propina
     or new.total is distinct from old.total
     or new.nota is distinct from old.nota
     or new.fecha is distinct from old.fecha
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se liquidó no se edita: anula la liquidación con motivo y vuelve a liquidar.' using errcode = '42501';
  end if;
  if old.anulada and not new.anulada then
    raise exception 'Una liquidación anulada no se reactiva: se liquida de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_inmutables on public.liquidaciones;
create trigger trg_liquidacion_inmutables before update on public.liquidaciones
  for each row execute function public.fn_liquidacion_inmutables();

-- Al anular una liquidación, sus cobros dejan de estar liquidados (vuelven a ser pendientes).
create or replace function public.fn_liquidacion_anulada()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.anulada and not old.anulada then
    update public.liquidacion_cobros set vigente = false where liquidacion_id = new.id and vigente;
  end if;
  return null;
end $$;

drop trigger if exists trg_liquidacion_anulada on public.liquidaciones;
create trigger trg_liquidacion_anulada after update of anulada on public.liquidaciones
  for each row execute function public.fn_liquidacion_anulada();

-- Un renglón solo se puede crear si el cobro es del barbero de la liquidación, está vigente y vale lo que se anota.
create or replace function public.fn_liquidacion_cobro_validar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  select exists (
           select 1
             from public.cobros c
             join public.liquidaciones l on l.barberia_id = c.barberia_id and l.barbero_id = c.barbero_id
            where c.barberia_id = new.barberia_id and c.id = new.cobro_id and l.id = new.liquidacion_id
              and not c.anulado and not l.anulada
              and c.comision = new.comision and c.propina_barbero = new.propina_barbero)
    into v_ok;
  if not v_ok then
    raise exception 'Ese cobro no se puede liquidar en esta liquidación (otro barbero, anulado o con otros valores).';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_cobro_validar on public.liquidacion_cobros;
create trigger trg_liquidacion_cobro_validar before insert on public.liquidacion_cobros
  for each row execute function public.fn_liquidacion_cobro_validar();

-- De un renglón solo cambia `vigente`, y solo de true a false.
create or replace function public.fn_liquidacion_cobro_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.liquidacion_id is distinct from old.liquidacion_id
     or new.cobro_id is distinct from old.cobro_id
     or new.barberia_id is distinct from old.barberia_id
     or new.comision is distinct from old.comision
     or new.propina_barbero is distinct from old.propina_barbero
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se liquidó no se edita: anula la liquidación con motivo y vuelve a liquidar.' using errcode = '42501';
  end if;
  if new.vigente and not old.vigente then
    raise exception 'Una liquidación anulada no se reactiva: se liquida de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_liquidacion_cobro_inmutables on public.liquidacion_cobros;
create trigger trg_liquidacion_cobro_inmutables before update on public.liquidacion_cobros
  for each row execute function public.fn_liquidacion_cobro_inmutables();

drop trigger if exists trg_bloquear_borrado on public.liquidaciones;
create trigger trg_bloquear_borrado before delete on public.liquidaciones
  for each row execute function public.fn_bloquear_borrado();
drop trigger if exists trg_bloquear_borrado on public.liquidacion_cobros;
create trigger trg_bloquear_borrado before delete on public.liquidacion_cobros
  for each row execute function public.fn_bloquear_borrado();

-- Un cobro que ya se le pagó al barbero no se anula: primero hay que anular la liquidación.
create or replace function public.fn_cobro_liquidado_no_se_anula()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if new.anulado and not old.anulado then
    select b.nombre as barbero, l.fecha
      into v
      from public.liquidacion_cobros lc
      join public.liquidaciones l on l.barberia_id = lc.barberia_id and l.id = lc.liquidacion_id
      join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
     where lc.barberia_id = old.barberia_id and lc.cobro_id = old.id and lc.vigente;
    if found then
      raise exception 'Este cobro ya se le liquidó a % el %. Anula primero esa liquidación.', v.barbero, to_char(v.fecha, 'DD/MM/YYYY');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_cobro_liquidado_no_se_anula on public.cobros;
create trigger trg_cobro_liquidado_no_se_anula before update of anulado on public.cobros
  for each row execute function public.fn_cobro_liquidado_no_se_anula();

-- ---------------------------------------------------------------------
-- 3. Lectura (RLS): «comisiones» ve todas; el barbero, las suyas
-- ---------------------------------------------------------------------
alter table public.liquidaciones enable row level security;
alter table public.liquidacion_cobros enable row level security;

drop policy if exists liquidaciones_select on public.liquidaciones;
create policy liquidaciones_select on public.liquidaciones
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and (
      (select public.tiene_area('comisiones'))
      or ((select public.tiene_area('mi_agenda')) and barbero_id = (select public.mi_barbero()))
    )
  );

drop policy if exists liquidacion_cobros_select on public.liquidacion_cobros;
create policy liquidacion_cobros_select on public.liquidacion_cobros
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and exists (select 1 from public.liquidaciones l
                 where l.barberia_id = liquidacion_cobros.barberia_id and l.id = liquidacion_cobros.liquidacion_id)
  );

grant select on public.liquidaciones, public.liquidacion_cobros to authenticated;

-- ---------------------------------------------------------------------
-- 4. Liquidar y anular
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_liquidacion(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res     jsonb;
  v_anulada boolean;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', l.id, 'barbero_id', l.barbero_id, 'barbero', b.nombre,
           'cobros', l.cobros, 'comision', l.comision, 'propina', l.propina, 'total', l.total,
           'medio', l.medio, 'hasta', l.hasta, 'fecha', l.fecha, 'anulada', l.anulada),
         l.anulada
    into v_res, v_anulada
    from public.liquidaciones l
    join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
   where l.barberia_id = p_barberia and l.id = p_id;

  -- Repetir la clave de una liquidación que ya se anuló no la da por hecha.
  if p_ya and coalesce(v_anulada, false) then
    raise exception 'Esa liquidación ya se anuló. Abre Liquidar de nuevo para pagar otra vez.';
  end if;
  return v_res;
end $$;

-- Le paga a un barbero todo lo pendiente (cobros vigentes que no están en otra liquidación vigente) hasta p_hasta.
create or replace function public.liquidar_comisiones(
  p_barbero uuid, p_hasta date, p_medio text, p_clave uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
  v_prev     uuid;
  v_nombre   text;
  v_ids      uuid[];
  v_n        integer;
  v_com      integer;
  v_prop     integer;
  v_nota     text := nullif(left(public.fn_limpiar_texto(p_nota), 200), '');
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave de la liquidación. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve la liquidación que ya se hizo.
  select l.id into v_prev from public.liquidaciones l where l.barberia_id = v_barberia and l.clave = p_clave;
  if found then
    return public.fn_resultado_liquidacion(v_barberia, v_prev, true);
  end if;

  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    raise exception 'Elige cómo se le paga: efectivo o transferencia.';
  end if;
  if p_hasta is null then
    raise exception 'Elige hasta qué día se liquida.';
  end if;

  -- Un barbero a la vez: dos liquidaciones simultáneas del mismo barbero se ponen en fila.
  select b.nombre into v_nombre from public.barberos b
   where b.barberia_id = v_barberia and b.id = p_barbero
     for no key update;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;

  -- Lo pendiente, con los cobros bloqueados: si alguien los anula a la vez, o se espera o se descartan.
  select array_agg(x.id order by x.fecha, x.created_at, x.id),
         count(*)::integer, coalesce(sum(x.comision), 0)::integer, coalesce(sum(x.propina_barbero), 0)::integer
    into v_ids, v_n, v_com, v_prop
    from (select c.id, c.fecha, c.created_at, c.comision, c.propina_barbero
            from public.cobros c
           where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
             and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
             for update of c) x;

  if v_n = 0 then
    raise exception 'No hay nada por liquidar de % hasta el %.', v_nombre, to_char(p_hasta, 'DD/MM/YYYY');
  end if;

  begin
    insert into public.liquidaciones (id, barberia_id, barbero_id, clave, hasta, medio, cobros, comision, propina, total,
                                      nota, fecha)
    values (v_id, v_barberia, p_barbero, p_clave, p_hasta, p_medio, v_n, v_com, v_prop, v_com + v_prop,
            v_nota, public.fn_jornada(v_barberia, now()));
  exception when unique_violation then
    -- Dos toques a la vez con la misma clave.
    select l.id into v_prev from public.liquidaciones l where l.barberia_id = v_barberia and l.clave = p_clave;
    if found then
      return public.fn_resultado_liquidacion(v_barberia, v_prev, true);
    end if;
    raise;
  end;

  insert into public.liquidacion_cobros (barberia_id, liquidacion_id, cobro_id, comision, propina_barbero)
  select v_barberia, v_id, c.id, c.comision, c.propina_barbero
    from public.cobros c
   where c.barberia_id = v_barberia and c.id = any (v_ids);

  return public.fn_resultado_liquidacion(v_barberia, v_id, false);
end $$;

-- Anula una liquidación con motivo: sus cobros vuelven a estar pendientes.
create or replace function public.anular_liquidacion(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('comisiones');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_anulada  boolean;
  v_cobros   integer;
begin
  select l.anulada, l.cobros into v_anulada, v_cobros
    from public.liquidaciones l where l.barberia_id = v_barberia and l.id = p_id
     for update;
  if not found then
    raise exception 'No existe esa liquidación.' using errcode = 'P0002';
  end if;
  if v_anulada then
    raise exception 'Esta liquidación ya está anulada.';
  end if;

  update public.liquidaciones
     set anulada = true, anulada_motivo = v_motivo, anulada_por = auth.uid(), anulada_at = now()
   where barberia_id = v_barberia and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'cobros', v_cobros);
end $$;

-- ---------------------------------------------------------------------
-- 5. Lecturas
-- ---------------------------------------------------------------------

-- Por barbero: lo que generó en el periodo (cobros, servicios, comisión, propina, cuánto de eso ya se liquidó) y lo
-- que falta por pagarle hasta p_hasta (incluye lo de periodos anteriores). «comisiones» ve a todos; el barbero, lo suyo.
create or replace function public.obtener_resumen_comisiones(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
begin
  if not v_todos and not (public.tiene_area('mi_agenda') and v_mio is not null) then
    raise exception 'No tienes permiso para ver las comisiones. Pídeselo al dueño.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El periodo no es válido.';
  end if;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'todos', v_todos,
    'barberos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', b.id, 'nombre', b.nombre, 'activo', b.activo,
                 'cobros', coalesce(p.cobros, 0), 'servicios', coalesce(p.servicios, 0),
                 'comision', coalesce(p.comision, 0), 'propina', coalesce(p.propina, 0),
                 'liquidado', coalesce(p.liquidado, 0),
                 'pendiente_cobros', coalesce(q.cobros, 0),
                 'pendiente', coalesce(q.comision, 0) + coalesce(q.propina, 0),
                 'pendiente_desde', q.desde)
               order by b.activo desc, b.orden, lower(b.nombre))
        from public.barberos b
        left join lateral (
          select count(*)::integer as cobros, sum(c.total)::integer as servicios,
                 sum(c.comision)::integer as comision, sum(c.propina_barbero)::integer as propina,
                 sum(case when exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
                          then c.comision + c.propina_barbero else 0 end)::integer as liquidado
            from public.cobros c
           where c.barberia_id = b.barberia_id and c.barbero_id = b.id and not c.anulado
             and c.fecha between p_desde and p_hasta) p on true
        left join lateral (
          select count(*)::integer as cobros, sum(c.comision)::integer as comision,
                 sum(c.propina_barbero)::integer as propina, min(c.fecha) as desde
            from public.cobros c
           where c.barberia_id = b.barberia_id and c.barbero_id = b.id and not c.anulado and c.fecha <= p_hasta
             and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)) q on true
       where b.barberia_id = v_barberia and (v_todos or b.id = v_mio)
         and (b.activo or coalesce(p.cobros, 0) > 0 or coalesce(q.cobros, 0) > 0)), '[]'::jsonb));
end $$;

-- Un barbero: lo que se le debe hasta p_hasta (con los cobros, los 200 más recientes) y sus últimas liquidaciones.
create or replace function public.obtener_comisiones_de_barbero(p_barbero uuid, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
  v_b        record;
begin
  if not v_todos and not (public.tiene_area('mi_agenda') and v_mio is not null and v_mio = p_barbero) then
    raise exception 'No tienes permiso para ver las comisiones de otro barbero.' using errcode = '42501';
  end if;
  if p_hasta is null then
    raise exception 'Elige hasta qué día se mira.';
  end if;
  select b.id, b.nombre, b.activo into v_b from public.barberos b where b.barberia_id = v_barberia and b.id = p_barbero;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'barbero', jsonb_build_object('id', v_b.id, 'nombre', v_b.nombre, 'activo', v_b.activo),
    'hasta', p_hasta,
    'pendiente', (
      select jsonb_build_object(
               'cobros', count(*)::integer, 'comision', coalesce(sum(c.comision), 0)::integer,
               'propina', coalesce(sum(c.propina_barbero), 0)::integer,
               'total', (coalesce(sum(c.comision), 0) + coalesce(sum(c.propina_barbero), 0))::integer,
               'desde', min(c.fecha))
        from public.cobros c
       where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
         and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)),
    'cobros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'fecha', k.fecha, 'created_at', k.created_at, 'cliente', k.cliente, 'servicios', k.servicios,
               'total', k.total, 'comision', k.comision, 'propina_barbero', k.propina_barbero)
             order by k.fecha desc, k.created_at desc, k.id)
        from (select c.id, c.fecha, c.created_at, cl.nombre as cliente, c.total, c.comision, c.propina_barbero,
                     (select string_agg(i.nombre, ', ' order by i.orden)
                        from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id) as servicios
                from public.cobros c
                left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
               where c.barberia_id = v_barberia and c.barbero_id = p_barbero and not c.anulado and c.fecha <= p_hasta
                 and not exists (select 1 from public.liquidacion_cobros lc where lc.cobro_id = c.id and lc.vigente)
               order by c.fecha desc, c.created_at desc, c.id
               limit 200) k), '[]'::jsonb),
    'liquidaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'created_at', l.created_at, 'fecha', l.fecha, 'hasta', l.hasta, 'total', l.total,
               'cobros', l.cobros, 'medio', l.medio, 'anulada', l.anulada)
             order by l.created_at desc, l.id)
        from (select * from public.liquidaciones x
               where x.barberia_id = v_barberia and x.barbero_id = p_barbero
               order by x.created_at desc, x.id
               limit 20) l), '[]'::jsonb));
end $$;

-- Una liquidación con los cobros que pagó (null si no existe o quien pregunta no la puede ver).
create or replace function public.obtener_liquidacion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_todos    boolean := public.tiene_area('comisiones');
  v_mio      uuid := public.mi_barbero();
  v_res      jsonb;
begin
  select jsonb_build_object(
           'id', l.id, 'barbero_id', l.barbero_id, 'barbero', b.nombre,
           'hasta', l.hasta, 'fecha', l.fecha, 'medio', l.medio, 'cobros', l.cobros,
           'comision', l.comision, 'propina', l.propina, 'total', l.total, 'nota', l.nota, 'created_at', l.created_at,
           'anulada', l.anulada, 'anulada_motivo', l.anulada_motivo, 'anulada_at', l.anulada_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'cobro_id', c.id, 'fecha', c.fecha, 'created_at', c.created_at, 'cliente', cl.nombre,
                      'servicios', (select string_agg(i.nombre, ', ' order by i.orden)
                                      from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id),
                      'total', c.total, 'comision', lc.comision, 'propina_barbero', lc.propina_barbero)
                    order by c.fecha, c.created_at, c.id)
               from public.liquidacion_cobros lc
               join public.cobros c on c.barberia_id = lc.barberia_id and c.id = lc.cobro_id
               left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
              where lc.barberia_id = l.barberia_id and lc.liquidacion_id = l.id), '[]'::jsonb))
    into v_res
    from public.liquidaciones l
    join public.barberos b on b.barberia_id = l.barberia_id and b.id = l.barbero_id
   where l.barberia_id = v_barberia and l.id = p_id
     and (v_todos or (public.tiene_area('mi_agenda') and v_mio is not null and l.barbero_id = v_mio));
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- 6. Un cobro (copia de la ÚLTIMA versión, la de 0019) con un dato más: la liquidación que lo paga, si hay una vigente
--    (solo la ve quien puede ver liquidaciones)
-- ---------------------------------------------------------------------
create or replace function public.obtener_cobro(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', c.id, 'cita_id', c.cita_id,
           'barbero_id', c.barbero_id, 'barbero', b.nombre,
           'cliente_id', c.cliente_id, 'cliente', cl.nombre,
           'subtotal', c.subtotal, 'descuento', c.descuento, 'descuento_motivo', c.descuento_motivo,
           'total', c.total, 'propina', c.propina, 'comision', c.comision, 'propina_barbero', c.propina_barbero,
           'fecha', c.fecha, 'created_at', c.created_at,
           'anulado', c.anulado, 'anulado_motivo', c.anulado_motivo, 'anulado_at', c.anulado_at,
           'liquidacion_id', (select lc.liquidacion_id from public.liquidacion_cobros lc
                               where lc.barberia_id = c.barberia_id and lc.cobro_id = c.id and lc.vigente),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', i.id, 'tipo', i.tipo, 'servicio_id', i.servicio_id, 'nombre', i.nombre, 'precio', i.precio,
                      'precio_lista', i.precio_lista, 'descuento', i.descuento, 'comision_pct', i.comision_pct,
                      'comision', i.comision) order by i.orden)
               from public.cobro_items i where i.barberia_id = c.barberia_id and i.cobro_id = c.id), '[]'::jsonb),
           'pagos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'medio', p.medio, 'monto', p.monto, 'recibido', p.recibido, 'vuelto', p.vuelto,
                      'referencia', p.referencia) order by p.created_at, p.id)
               from public.cobro_pagos p where p.barberia_id = c.barberia_id and p.cobro_id = c.id), '[]'::jsonb))
    from public.cobros c
    join public.barberos b on b.barberia_id = c.barberia_id and b.id = c.barbero_id
    left join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
   where c.id = p_id
$$;

select public.fn_aplicar_permisos();
