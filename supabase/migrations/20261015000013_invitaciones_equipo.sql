-- =====================================================================
-- BARBERÍAS · 0013 · EL EQUIPO ENTRA CON UN CÓDIGO (tarea 1.9 · SPEC F1)
--
--   1. INVITACIÓN: quien administra el equipo (área "equipo") escribe el nombre de la persona, le elige roles y
--      (si es barbero) a qué barbero corresponde. La base le da un código de 8 letras y números (sin 0/O/1/I, para que
--      no se confundan) que sirve UNA vez y por 3 días. En el celular de esa persona se abre /unirme (con el enlace o
--      escribiendo el código): la app abre una sesión anónima de Supabase en ese celular y canjea el código, que
--      crea su perfil en la barbería con esos roles y la vincula con su barbero. Sin correo ni contraseña.
--      El código se guarda tal cual (para volver a mostrarlo mientras esté vigente); nadie lee la tabla directamente:
--      solo listar_equipo, para quien administra el equipo.
--   2. QUITAR DEL EQUIPO: esa persona pierde el acceso al instante (su perfil y sus roles se van; el barbero que
--      tenía vinculado se conserva, solo queda sin cuenta).
--   3. SIN ESCALAR PERMISOS: nadie le da a otro más áreas de las que ya tiene. Quien administra el equipo solo
--      asigna roles cuyas áreas ya abre, y no toca a quien tiene más poder que él. El dueño lo abre todo.
--
-- No hay (todavía) pantalla para crear o editar roles: la barbería arranca con Barbero y Recepción.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Invitaciones
-- ---------------------------------------------------------------------
create table if not exists public.invitaciones (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  codigo         text not null check (codigo ~ '^[A-HJ-NP-Z2-9]{8}$'),
  nombre         text not null check (length(btrim(nombre)) between 1 and 40),
  roles          uuid[] not null default '{}',      -- ids de roles_equipo de esta barbería (se revisan al canjear)
  barbero_id     uuid,                              -- el barbero que esta persona será (opcional)
  expira_at      timestamptz not null,
  usada_at       timestamptz,
  usada_por      uuid references auth.users(id) on delete set null,
  anulada_at     timestamptz,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_invitaciones_codigo unique (codigo),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id)
);
create index if not exists idx_invitaciones_barberia on public.invitaciones (barberia_id, created_at);
comment on table public.invitaciones is 'Códigos para que una persona entre al equipo desde su celular (un uso, 3 días).';

alter table public.invitaciones enable row level security;
-- Sin políticas y sin privilegios: el código es una llave. Solo las funciones de abajo la leen.

-- 8 caracteres de 32 posibles (2^40 combinaciones), con bytes aleatorios de un uuid v4 (los que no llevan la
-- versión ni la variante).
create or replace function public.fn_codigo_invitacion()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes  bytea := uuid_send(gen_random_uuid());
  v_codigo text := '';
  i        integer;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_codigo := v_codigo || substr(v_letras, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_codigo;
end $$;

-- Roles activos de la barbería a partir de un arreglo jsonb de ids. Si alguno no existe (o es de otra barbería), error.
create or replace function public.fn_roles_validos(p_barberia uuid, p_roles jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_roles uuid[];
begin
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' then
    raise exception 'Elige los roles de esta persona.';
  end if;
  begin
    select coalesce(array_agg(distinct x.valor::uuid), '{}'::uuid[]) into v_roles
      from jsonb_array_elements_text(p_roles) as x(valor);
  exception when invalid_text_representation then
    raise exception 'El rol no existe.' using errcode = 'P0002';
  end;
  if (select count(*) from public.roles_equipo
       where barberia_id = p_barberia and activo and id = any (v_roles)) <> cardinality(v_roles) then
    raise exception 'El rol no existe.' using errcode = 'P0002';
  end if;
  return v_roles;
end $$;

-- Nadie da más áreas de las que tiene: las áreas de esos roles deben estar TODAS entre las de quien llama.
create or replace function public.fn_exigir_roles_asignables(p_barberia uuid, p_roles uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedidas text[];
begin
  select coalesce(array_agg(distinct a), '{}'::text[]) into v_pedidas
    from public.roles_equipo r, unnest(r.areas) a
   where r.barberia_id = p_barberia and r.id = any (p_roles);
  if not (v_pedidas <@ coalesce(public.fn_areas_de(auth.uid()), '{}'::text[])) then
    raise exception 'No puedes dar permisos que tú no tienes.' using errcode = '42501';
  end if;
end $$;

-- ¿Las áreas de esa persona caben entre las de quien llama? (para no tocar a alguien con más poder)
create or replace function public.fn_exigir_poder_sobre(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (coalesce(public.fn_areas_de(p_user), '{}'::text[]) <@ coalesce(public.fn_areas_de(auth.uid()), '{}'::text[])) then
    raise exception 'No puedes cambiar a alguien con más permisos que tú.' using errcode = '42501';
  end if;
end $$;

-- Invita a alguien: nombre, roles y (si es barbero) cuál. Devuelve el código y hasta cuándo sirve.
create or replace function public.crear_invitacion(p_nombre text, p_roles jsonb, p_barbero uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_nombre   text := left(public.fn_limpiar_texto(p_nombre), 40);
  v_roles    uuid[];
  v_codigo   text;
  v_id       uuid;
  v_expira   timestamptz := now() + interval '72 hours';
begin
  if length(v_nombre) = 0 then
    raise exception 'Escribe el nombre de la persona.';
  end if;
  v_roles := public.fn_roles_validos(v_barberia, p_roles);
  if cardinality(v_roles) = 0 then
    raise exception 'Elige al menos un rol: sin roles no podría hacer nada.';
  end if;
  perform public.fn_exigir_roles_asignables(v_barberia, v_roles);

  if p_barbero is not null then
    if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and activo) then
      raise exception 'No existe ese barbero.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and user_id is not null) then
      raise exception 'Ese barbero ya tiene una cuenta.';
    end if;
  end if;

  if (select count(*) from public.perfiles where barberia_id = v_barberia) >= 30 then
    raise exception 'El equipo ya tiene 30 personas. Quita a alguien que ya no trabaje contigo.';
  end if;
  if (select count(*) from public.invitaciones
       where barberia_id = v_barberia and usada_at is null and anulada_at is null and expira_at > now()) >= 10 then
    raise exception 'Hay muchas invitaciones sin usar. Anula alguna antes de crear otra.';
  end if;

  -- Limpieza oportunista: lo que ya no sirve y tiene más de 30 días.
  delete from public.invitaciones
   where barberia_id = v_barberia and created_at < now() - interval '30 days'
     and (usada_at is not null or anulada_at is not null or expira_at < now());

  loop
    v_codigo := public.fn_codigo_invitacion();
    exit when not exists (select 1 from public.invitaciones where codigo = v_codigo);
  end loop;

  insert into public.invitaciones (barberia_id, codigo, nombre, roles, barbero_id, expira_at)
  values (v_barberia, v_codigo, v_nombre, v_roles, p_barbero, v_expira)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'nombre', v_nombre, 'expira_at', v_expira);
end $$;

create or replace function public.anular_invitacion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
begin
  update public.invitaciones set anulada_at = now()
   where id = p_id and barberia_id = v_barberia and usada_at is null and anulada_at is null;
  if not found then
    raise exception 'La invitación no existe o ya se usó.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- En el celular de la persona invitada (ya con su sesión anónima): el código la vuelve parte del equipo.
create or replace function public.canjear_invitacion(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_codigo  text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv     public.invitaciones%rowtype;
  v_de      text;
  v_vinculado boolean := false;
begin
  if v_uid is null then
    raise exception 'Abre la invitación en el celular que vas a usar.' using errcode = '42501';
  end if;
  select b.nombre into v_de
    from public.perfiles p join public.barberias b on b.id = p.barberia_id
   where p.user_id = v_uid;
  if found then
    raise exception 'Este celular ya está en el equipo de %. Para unirte con otro código, sal de la app primero.', v_de;
  end if;

  select * into v_inv from public.invitaciones
   where codigo = v_codigo and usada_at is null and anulada_at is null and expira_at > now()
   for update;
  if not found then
    raise exception 'Ese código no sirve: revisa que esté bien escrito, o pide uno nuevo (cada código sirve una sola vez y por 3 días).'
      using errcode = 'P0002';
  end if;

  insert into public.perfiles (user_id, barberia_id, rol, nombre)
  values (v_uid, v_inv.barberia_id, 'equipo', v_inv.nombre);

  insert into public.perfil_roles (barberia_id, user_id, rol_id, registrado_por)
  select v_inv.barberia_id, v_uid, r.id, v_inv.registrado_por
    from public.roles_equipo r
   where r.barberia_id = v_inv.barberia_id and r.activo and r.id = any (v_inv.roles);

  -- Si la invitación era para un barbero y todavía no tiene cuenta, esta persona pasa a serlo.
  if v_inv.barbero_id is not null then
    update public.barberos set user_id = v_uid
     where barberia_id = v_inv.barberia_id and id = v_inv.barbero_id and user_id is null and activo;
    v_vinculado := found;
  end if;

  update public.invitaciones set usada_at = now(), usada_por = v_uid where id = v_inv.id;

  return jsonb_build_object(
    'barberia', (select nombre from public.barberias where id = v_inv.barberia_id),
    'nombre', v_inv.nombre,
    'areas', to_jsonb(public.fn_areas_de(v_uid)),
    'barbero_vinculado', v_vinculado
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. Administrar el equipo
-- ---------------------------------------------------------------------

-- Quita a alguien: su celular pierde el acceso al instante (su perfil y sus roles se van; el barbero se conserva).
create or replace function public.quitar_del_equipo(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_p        public.perfiles%rowtype;
begin
  select * into v_p from public.perfiles where user_id = p_user_id and barberia_id = v_barberia for update;
  if not found then
    raise exception 'Esa persona no es de tu equipo.' using errcode = 'P0002';
  end if;
  if v_p.rol = 'dueno' then
    raise exception 'Al dueño no se le puede quitar del equipo.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes quitarte a ti mismo del equipo.';
  end if;
  perform public.fn_exigir_poder_sobre(p_user_id);

  delete from public.perfiles where user_id = p_user_id and barberia_id = v_barberia;  -- sus roles se van con él
  return jsonb_build_object('user_id', p_user_id, 'nombre', v_p.nombre);
end $$;

-- Deja a la persona con exactamente estos roles.
create or replace function public.cambiar_roles_miembro(p_user_id uuid, p_roles jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
  v_p        public.perfiles%rowtype;
  v_roles    uuid[];
begin
  select * into v_p from public.perfiles where user_id = p_user_id and barberia_id = v_barberia for update;
  if not found then
    raise exception 'Esa persona no es de tu equipo.' using errcode = 'P0002';
  end if;
  if v_p.rol = 'dueno' then
    raise exception 'El dueño ya tiene todos los permisos.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes cambiar tus propios roles.';
  end if;

  v_roles := public.fn_roles_validos(v_barberia, p_roles);
  if cardinality(v_roles) = 0 then
    raise exception 'Elige al menos un rol: sin roles no podría hacer nada.';
  end if;
  perform public.fn_exigir_poder_sobre(p_user_id);
  perform public.fn_exigir_roles_asignables(v_barberia, v_roles);

  delete from public.perfil_roles where barberia_id = v_barberia and user_id = p_user_id;
  insert into public.perfil_roles (barberia_id, user_id, rol_id)
  select v_barberia, p_user_id, r from unnest(v_roles) r;
  return jsonb_build_object('user_id', p_user_id, 'areas', to_jsonb(public.fn_areas_de(p_user_id)));
end $$;

-- El equipo: roles (con sus áreas), personas (con roles y barbero) e invitaciones pendientes (con su código).
-- Solo para quien administra el equipo.
create or replace function public.listar_equipo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('equipo');
begin
  return jsonb_build_object(
    'areas', to_jsonb(public.fn_areas()),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'nombre', r.nombre, 'areas', to_jsonb(r.areas),
               'personas', (select count(*) from public.perfil_roles pr
                             where pr.barberia_id = v_barberia and pr.rol_id = r.id)
             ) order by r.orden, r.nombre)
        from public.roles_equipo r
       where r.barberia_id = v_barberia and r.activo), '[]'::jsonb),
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', p.user_id, 'nombre', p.nombre, 'rol', p.rol, 'yo', p.user_id = auth.uid(),
               'roles', coalesce((select jsonb_agg(pr.rol_id order by r.orden, r.nombre)
                                    from public.perfil_roles pr
                                    join public.roles_equipo r
                                      on r.barberia_id = pr.barberia_id and r.id = pr.rol_id and r.activo
                                   where pr.barberia_id = v_barberia and pr.user_id = p.user_id), '[]'::jsonb),
               'areas', to_jsonb(public.fn_areas_de(p.user_id)),
               'barbero', (select jsonb_build_object('id', b.id, 'nombre', b.nombre)
                             from public.barberos b
                            where b.barberia_id = v_barberia and b.user_id = p.user_id)
             ) order by p.rol = 'dueno' desc, p.created_at, p.nombre)
        from public.perfiles p
       where p.barberia_id = v_barberia), '[]'::jsonb),
    'invitaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'nombre', i.nombre, 'codigo', i.codigo, 'expira_at', i.expira_at,
               'roles', coalesce((select jsonb_agg(r.id order by r.orden, r.nombre)
                                    from public.roles_equipo r
                                   where r.barberia_id = v_barberia and r.activo and r.id = any (i.roles)), '[]'::jsonb),
               'barbero', (select jsonb_build_object('id', b.id, 'nombre', b.nombre)
                             from public.barberos b
                            where b.barberia_id = v_barberia and b.id = i.barbero_id)
             ) order by i.created_at desc)
        from public.invitaciones i
       where i.barberia_id = v_barberia and i.usada_at is null and i.anulada_at is null and i.expira_at > now()),
      '[]'::jsonb)
  );
end $$;

select public.fn_aplicar_permisos();
