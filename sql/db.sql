drop database if exists business;
create database business;

drop user if exists smuser;
create user smuser with password 'test';

grant all privileges on database business to smuser;

\c business;
set role smuser;

/* Penalizaciones */
drop table if exists penalizaciones cascade;
create table penalizaciones (
    id serial primary key,
    nombre text,
    monto numeric(1000,2),
    descripcion text,
    dias_retraso integer,  /* Debe reiniciar cada semana.*/
    dias_antes integer /* Debe reiniciar cada semana.*/
    );


/* Tiendas */
drop table if exists tiendas cascade;
create table tiendas (
    id serial primary key,
    nombre text,
    RFC text,
    direccion_calle text,
    direccion_numero_int text,
    direccion_numero_ext text,
    direccion_colonia text,
    direccion_localidad text,
    direccion_municipio text,
    direccion_ciudad text,
    direccion_estado text,
    direccion_pais text
);

insert into tiendas (nombre, direccion_calle, direccion_numero_int, direccion_numero_ext, direccion_colonia,
direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais) values
('Celine','20 de noviembre','-','-','-','-','-','-','Ciudad de México','México');

insert into tiendas (nombre, direccion_calle, direccion_numero_int, direccion_numero_ext, direccion_colonia,
direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais) values
('Bianca','20 de noviembre','-','-','-','-','-','-','Ciudad de México','México');

insert into tiendas (nombre, direccion_calle, direccion_numero_int, direccion_numero_ext, direccion_colonia,
direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais) values
('Imagen','20 de noviembre','-','-','-','-','-','-','Ciudad de México','México');

insert into tiendas (nombre, direccion_calle, direccion_numero_int, direccion_numero_ext, direccion_colonia,
direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais) values
('Mariana','20 de noviembre','-','-','-','-','-','-','Ciudad de México','México');


/* Bonos */
drop table if exists bonos cascade;
create table bonos (
    id serial primary key,
    nombre text,
    monto numeric(1000,2),
    descripcion text,
    monto_alcanzar numeric(1000,2),
    criterio text,
    temporalidad text,
    id_tienda integer references tiendas(id)
    );

/* Premios */
drop table if exists premios cascade;
create table premios (
   id serial primary key,
   nombre text,
   monto numeric(1000,2),
   descripcion text,
   monto_alcanzar numeric(1000,2),
   criterio text,
   temporalidad text,
   id_tienda integer references tiendas(id)
   );


/* Usuarios */
drop table if exists usuarios cascade;
create table usuarios(
    id serial primary key,
    id_tienda integer references tiendas(id),
    usuario text,
    contrasena text,
    email text,
    nombres text,
    apellido_paterno text,
    apellido_materno text,
    rfc text,
    direccion_calle text,
    direccion_numero_int text,
    direccion_numero_ext text,
    direccion_colonia text,
    direccion_localidad text,
    direccion_municipio text,
    direccion_ciudad text,
    direccion_estado text,
    direccion_pais text,
    empleado boolean,
    salario numeric(1000,2),
    permiso_tablero boolean,
    permiso_administrador boolean,
    permiso_empleados boolean,
    permiso_inventario boolean,
    hora_llegada time,
    hora_salida time
);

insert into usuarios ("id_tienda","usuario","contrasena","nombres","apellido_paterno","apellido_materno","permiso_tablero","permiso_administrador","permiso_empleados", "permiso_inventario") values
(1,'admin','$2a$10$DmxbjTLBYDdcha8qlXpsaOyUqkJ0BAQ3Q4EIyMtr5HLXm6R0gSvbm','Administrador','','', true, true, true, true);

/* prestamos */
drop table if exists prestamos cascade;
create table prestamos (
    id serial primary key,
    id_usuario integer references usuarios(id),
    monto numeric(1000,2),
    pago_semanal numeric(1000,2),
    descripcion text,
    fecha_prestamo date,
    fecha_liquidacion date
);

/* pagos extra */
drop table if exists pagos_extra cascade;
create table pagos_extra (
    id serial primary key,
    id_usuario integer references usuarios(id),
    monto numeric(1000,2),
    descripcion text,
    fecha_pago_extra date
);

/* asistencia */
drop table if exists asistencia cascade;
create table asistencia (
    id serial primary key,
    id_usuario integer references usuarios(id),
    fecha date,
    hora_llegada time,
    hora_salida time
);

/* Proveedores */
drop table if exists proveedores cascade;
create table proveedores (
    id serial primary key,
    nombre text,
    razon_social text,
    rfc text,
    direccion_calle text,
    direccion_numero_int text,
    direccion_numero_ext text,
    direccion_colonia text,
    direccion_localidad text,
    direccion_municipio text,
    direccion_ciudad text,
    direccion_estado text,
    direccion_pais text,
    a_cuenta  numeric(1000,2), /* Esta cantidad se registra en el momento en el que se registra una prenda del proveedor*/
    por_pagar numeric(1000,2)  /* Esta cantidad se registra en el momento en el que se vende una prenda del proveedor */
);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio,
direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Cocoon','-','-','-','-','-','-','-', '-', '-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais , a_cuenta, por_pagar) values
                        ('Eli Corame','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Ema Valdemosa','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Lessan','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Libertad','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Neon Nyx','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Nicoletta','-','-','-','-','-','-','-','-','-', 'Ciudad de México','México', 0, 0);

insert into proveedores (nombre, razon_social, rfc, direccion_calle, direccion_numero_int,
direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais, a_cuenta, por_pagar) values
                        ('Punto Blanco','-','-','-','-','-','-','-','-','-','Ciudad de México','México', 0, 0);

drop table if exists marcas cascade;
create table marcas (
id serial primary key,
nombre text,
descripcion text
);

insert into marcas(nombre, descripcion) values ('Cocoon', 'Marca de proveedor Cocoon');
insert into marcas(nombre, descripcion) values ('Eli Corame', 'Marca de proveedor Eli Corame');
insert into marcas(nombre, descripcion) values ('Ema Valdemosa', 'Marca de proveedor Ema Valdemosa');
insert into marcas(nombre, descripcion) values ('Lessan', 'Marca de proveedor Lessan');
insert into marcas(nombre, descripcion) values ('Libertad', 'Marca de proveedor Libertad');
insert into marcas(nombre, descripcion) values ('D mosseli', 'Marca de proveedor Libertad');
insert into marcas(nombre, descripcion) values ('Neon Nyx', 'Marca de proveedor Neon Nyx');
insert into marcas(nombre, descripcion) values ('Nicoletta', 'Marca de proveedor Nicoleta');
insert into marcas(nombre, descripcion) values ('Punto Blanco', 'Marca de proveedor Punto Blanco');

/* Inventario */
drop table if exists articulos cascade;
create table articulos (
    id serial primary key,
    id_proveedor integer references proveedores(id),
    id_tienda integer references tiendas(id),
    articulo text,
    descripcion text,
    id_marca integer references marcas(id) on delete set null,
    modelo text,
    talla text,
    notas text,
    precio numeric(1000,2),
    costo numeric(1000,2),
    codigo_barras numeric(1000,2),
    nombre_imagen text,
    n_existencias integer
);


/* Inventario Solicitado*/
drop table if exists articulos_solicitados cascade;
create table articulos_solicitados (
    id serial primary key,
    id_articulo integer references articulos(id),
    n_solicitudes integer
);


/* Nota entrada */
drop table if exists nota_entrada cascade;
create table nota_entrada(
    id serial primary key,
    id_nota_registro text, /* Nota del proveedor */
    id_articulo integer references articulos(id),
    id_usuario integer references usuarios(id),
    num_arts    integer,
    hora time,
    fecha date
);

/* Nota devolución */
drop table if exists nota_devolucion cascade;
create table nota_devolucion(
    id serial primary key,
    id_nota_devolucion text, /* Nota del proveedor */
    id_articulo integer references articulos(id),
    id_usuario integer references usuarios(id),
    num_arts    integer,
    hora time,
    fecha date
);

/* Nota modificacion */
drop table if exists nota_modificacion cascade;
create table nota_modificacion(
    id serial primary key,
    id_articulo integer references articulos(id),
    id_usuario integer references usuarios(id),
    modificacion  text,
    hora time,
    fecha date
);

/* terminales */
drop table if exists terminales cascade;
create table terminales(
        id serial primary key,
        id_tienda integer references tiendas(id),
        banco text,
        nombre_facturador varchar(30),
        rfc text
);

insert into terminales (id_tienda, banco, nombre_facturador, rfc) values ('1', 'banamex', 'eduardo', 'rfcEduardo');


/* Carrito */
drop table if exists carrito cascade;
create table carrito (
        fecha date,
        id_articulo integer references articulos(id),
        id_usuario integer references usuarios(id),
        id_articulo_unidad text,
        discount    numeric(1000,2),
        monto_pagado numeric(1000,2),
        carrito_precio numeric(1000,2),
        unidades_carrito integer,
        estatus text
);

/*
 * --------------------------------------------------
 * Lógica de ventas (BEGIN)
 * --------------------------------------------------
 */

/* Ventas */
drop table if exists ventas cascade;
create table ventas (
    id bigserial primary key,
    id_nota integer not null,
    id_papel integer not null,
    id_tienda integer not null references tiendas(id) on delete set null,
    id_usuario integer references usuarios(id) on delete set null,
    precio_venta numeric(1000,2),
    estatus text /* cancelada, activa */
);

/* Venta articulos */
drop table if exists venta_articulos;
create table venta_articulos(
    id bigserial primary key,
    id_articulo integer references articulos(id),
    id_articulo_unidad text,
    id_venta integer references ventas(id),
    unidades_vendidas integer,
    discount    numeric(1000,2),
    precio numeric(1000,2),/* Falta incluir el precio que tenia el artículo en el momento de la venta */
    estatus  text  /* liquidada, compostura, devolucion, solicitada, pendiente_pago */
);

/* Transferencia */
/* NOTAR: liquidar un saldo deudor con clientes es el equivalente a una salida de efectivo */
drop table if exists transferencia;
create table transferencia (
    id bigserial primary key,
    id_venta integer references ventas(id),
    id_papel integer,
    motivo_transferencia text, /* venta, abono, devolucion */
    monto_efectivo numeric(1000, 2),
    monto_credito  numeric(1000, 2),
    monto_debito  numeric(1000, 2),
    fecha date,
    hora time,
    id_terminal integer references terminales(id) on delete set null
);

/*
 * --------------------------------------------------
 * Lógica de ventas (END)
 * --------------------------------------------------
 */


drop table if exists carrito_notas;
create table carrito_notas(
id_venta integer references ventas (id ),
id_usuario integer references usuarios(id)
);

/* Devolución de artículos */
drop table if exists devolucion_prov_articulos;
create table devolucion_prov_articulos(
    id serial primary key,
    id_articulo integer references articulos(id),
    id_proveedor integer references proveedores(id),
    unidades_regresadas integer,
    fecha date,
    costo_unitario numeric(1000,2)
);



/*
tipo_transaccion
retorno_mercancia
pago_mercancia
¿ esto debe existir ?
*/

/* transacciones */
drop table if exists transacciones;
 create table transacciones(
    id serial primary key,
    id_proveedor integer references proveedores(id),
    id_tipo_transaccion integer,
    notas text,
    monto numeric(1000,2)
    /* ... */
);

/* Operaciones nomina */
drop table if exists operaciones_nomina cascade;
create table operaciones_nomina(
    id serial primary key,
    operacion text
);

insert into operaciones_nomina("operacion") values
('Salario'),('Bono'),('Deducción');

/* Nomina */
drop table if exists nomina;
create table nomina (
    id serial primary key,
    id_usuario integer references usuarios(id),
    id_operacion integer references operaciones_nomina(id),
    monto numeric(1000,2),
    fecha date,
    hora time
);

/* Asistencia */
drop table if exists asistencia;
create table asistencia(
id serial primary key,
id_usuario integer references usuarios(id),
fecha date,
hora time,
tipo text
);




