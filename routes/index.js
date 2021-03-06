var express = require('express');
var router = express.Router();
var path = require('path');
var json2csv = require('json2csv'); //export -> csv
var fs = require('fs'); //read/write files
var db_conf = require('../db_conf');
// Using the flash middleware provided by connect-flash to store messages in session
// and displaying in templates
var flash = require('connect-flash');
router.use(flash());

// Configuring Passport
var passport = require('passport');
var expressSession = require('express-session');
var bCrypt = require('bcrypt-nodejs');

router.use(expressSession({secret: 'mySecretKey', resave: false, saveUninitialized: false}));
router.use(passport.initialize());
router.use(passport.session());
var LocalStrategy = require('passport-local').Strategy;

passport.use('login', new LocalStrategy({
        passReqToCallback: true
    },
    function (req, username, password, done) {
        // check in postgres if a user with username exists or not
        db_conf.db.oneOrNone('select * from usuarios where usuario = $1', [username]).then(function (user) {
            // session
            if (!user) {
                console.log('User Not Found with username ' + username);
                return done(null, false, req.flash('message', 'Usuario no registrado'));
            }

            if (!isValidPassword(user, password)) {
                console.log('Contraseña no válida');
                return done(null, false, req.flash('message', 'Contraseña no válida'));
            }

            return done(null, user);
        }).catch(function (error) {
            console.log(error);
            return done(error);
        });
    }
));

var isValidPassword = function (user, password) {
    return bCrypt.compareSync(password, user.contrasena);
};

// Passport needs to be able to serialize and deserialize users to support persistent login sessions
passport.serializeUser(function (user, done) {
    console.log('serializing user: ');
    console.log(user);
    done(null, user.id);
});

passport.deserializeUser(function (id, done) {
    db_conf.db.one(' select * from usuarios where id = $1', [id]).then(function (user) {
        //console.log('deserializing user:',user);
        done(null, user);
    }).catch(function (error) {
        done(error);
        console.log(error);
    });
});

var isAuthenticated = function (req, res, next) {
    // if user is authenticated in the session, call the next() to call the next request handler
    // Passport adds this method to request object. A middleware is allowed to add properties to
    // request and response objects
    if (req.isAuthenticated())
        return next();
    // if the user is not authenticated then redirect him to the login page
    res.redirect('/');
};

var isNotAuthenticated = function (req, res, next) {
    if (req.isUnauthenticated())
        return next();
    // if the user is authenticated then redirect him to the main page
    res.redirect('/principal');
};


// Generates hash using bCrypt
var createHash = function (password) {
    return bCrypt.hashSync(password, bCrypt.genSaltSync(10), null);
};

/*
 * ############################################
 *  Exec
 * ############################################
 */

/* Handle Login POST */
router.post('/login', passport.authenticate('login', {
    successRedirect: '/principal',
    failureRedirect: '/',
    failureFlash: true
}));

/* Handle Logout */
router.get('/signout', function (req, res) {
    req.logout();
    res.redirect('/');
});


/* GET login page. */
router.get('/', isNotAuthenticated, function (req, res, next) {
    res.render('login', {title: '', message: req.flash('message')});
});

router.get('/principal', isAuthenticated, function (req, res) {
    res.render('principal', {title: 'Tienda', user: req.user, section: 'principal'});
});

router.get('/admin', isAuthenticated, function (req, res) {
    if (req.user.permiso_administrador) {
        res.render('admin', {title: "Panel de administración del sistema", user: req.user, section: 'admin'});
    } else {
        res.redirect('/principal');
    }
});

router.get('/empleados', isAuthenticated, function (req, res) {
    if (req.user.permiso_empleados) {
        res.render('empleados', {title: "Panel de empleados", user: req.user, section: 'empleados'});
    } else {
        res.redirect('/principal');
    }

});

router.get('/inventario', isAuthenticated, function (req, res) {
    if (req.user.permiso_inventario) {
        res.render('inventario', {title: "Inventario", user: req.user, section: 'inventario'});
    } else {
        res.redirect('/principal');
    }
});

router.get('/tablero', isAuthenticated, function (req, res) {
    if (req.user.permiso_tablero) {
        res.render('tablero', {title: "Tablero de control", user: req.user, section: 'tablero'});
    } else {
        res.redirect('/principal');
    }
});

router.get('/carrito', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) { // El descuento se aplica al total de la venta, no a cada artículo!!!!
        return this.batch([
            this.manyOrNone('select * from carrito, proveedores, articulos, usuarios where carrito.id_articulo = articulos.id and articulos.id_proveedor = proveedores.id and  ' +
                ' carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1 order by id_articulo_unidad', [req.user.id]),
            this.manyOrNone('select sum(carrito_precio) as sum from carrito, articulos, usuarios where carrito.id_articulo = articulos.id and ' +
                ' carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1', [req.user.id]),
            this.manyOrNone('select carrito_precio as totales from carrito, articulos, usuarios where carrito.id_articulo = articulos.id and ' +
                'carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1 order by id_articulo_unidad', [req.user.id]),
            this.manyOrNone('select sum(monto_pagado) as sum from carrito, articulos, usuarios where carrito.id_articulo = articulos.id and ' +
                ' carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1', [req.user.id]),
        ]);

    }).then(function (data) {
        res.render('carrito', {
            title: "Venta en proceso",
            user: req.user,
            section: 'carrito',
            items: data[0],
            total: data[1],
            totales: data[2],
            monto: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Impresión de notas
router.get('/notas/imprimir', isAuthenticated, function (req, res) {

    //¿como generamos la numeración? ¿debe ser consecutiva?

    db_conf.db.manyOrNone("select id, precio_venta, hora_venta, fecha_venta, " +
        "(select string_agg(concat(articulo, ' (', unidades_vendidas,')'), ',') as articulos from venta_articulos, articulos " +
        "where venta_articulos.id_articulo=articulos.id and venta_articulos.id = carrito_notas.id_venta ) " +
        "from ventas, carrito_notas where ventas.id= carrito_notas.id_venta and carrito_notas.id_usuario=$1", req.user.id).then(function (data) {
        res.render('notas', {
            title: "Impresión en proceso",
            user: req.user,
            section: 'notas',
            notas: data
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


router.post('/notas/imprimir/agregar', function (req, res) {

    db_conf.db.one('select count(*) as count from carrito_notas where id_venta=$1 and id_usuario= $2', [
        req.body.id_venta,
        req.user.id
    ]).then(function (data) {

        if (data.count == 0) {
            return db_conf.db.one('insert into carrito_notas (id_venta, id_usuario) values ($1, $2) returning id_venta', [
                req.body.id_venta,
                req.user.id
            ]);
        }

        return null;

    }).then(function (data) {

        var response = {
            status: 'Ok',
            message: 'Nota añadida al carrito'
        };

        if (data == null) {
            response.status = 'Error';
            response.message = 'La nota ya se agregó previamente al carrito';
        }

        console.log(response);
        res.json(response);

    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al añadir la nota'
        });
    });

});

router.post('/notas/imprimir/remover', function (req, res) {
    console.log(req.body);

    db_conf.db.one('delete from carrito_notas where id_venta=$1 and id_usuario=$2 returning id_venta', [req.body.id_venta, req.user.id]).then(function (data) {
        console.log('Nota removida del carrito', data.id_venta);
        res.json({
            status: 'Ok',
            message: 'La nota se removió correctamente'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Ok',
            message: 'Ocurrió un error al quitar la nota'
        });

    });

});

router.post('/carrito/status', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update carrito set estatus = $1 where carrito.id_articulo_unidad = $2 and ' +
        'carrito.id_usuario = $3 returning id_articulo', [
        req.body.status,
        req.body.item_id,
        req.user.id
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se ha actualizado el estatus del artículo: ' + data.id_articulo
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ha ocurrido un error al actualizar el estatus'
        })
    })
});

router.post('/carrito/precio_unitario', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one(' update carrito set carrito_precio = $1, monto_pagado = $1, discount=$4 where carrito.id_articulo_unidad = $2 and carrito.id_usuario = $3 ' +
        ' returning id_articulo', [
        numericCol(req.body.precio),
        req.body.item_id,
        req.user.id,
        req.body.discount
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se ha actualizado el monto del articulo'
        })
    }).catch(function (error) {
        console.log(error)
        res.json({
            estatus: 'Error',
            message: 'Ocurrió un error al actualizar el precio'
        })
    })
})


router.post('/carrito/monto', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update carrito set monto_pagado = $1 where carrito.id_articulo_unidad = $2 and ' +
        'carrito.id_usuario = $3 returning id_articulo', [
        req.body.monto,
        req.body.item_id,
        req.user.id
    ]).then(function (data) {
        db_conf.db.one('select sum(monto_pagado) as monto_pagado from carrito where carrito.id_usuario = $1', [
            req.user.id
        ])
    }).then(function (data) {
        res.json({
            monto: data,
            status: 'Ok',
            message: 'Se ha actualizado el monto del articulo'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ha ocurrido un error'
        })
    })
});

router.post('/carrito/inc', isAuthenticated, function (req, res) {
    //console.log("id ITEM: " + req.body.item_id);
    console.log(req.body);
    db_conf.db.one('update carrito set unidades_carrito = unidades_carrito + 1 ' +
        'where carrito.id_articulo = $1 and carrito.id_usuario = $2 and carrito.estatus = $3 returning id_articulo', [
        numericCol(req.body.item_id),
        numericCol(req.user.id), //numericCol(req.body.user_id)
        req.body.estatus
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se ha agregado una unidad del artículo: ' + data.id_articulo
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ha ocurrido un error'
        })
    });
});

router.post('/carrito/dec', isAuthenticated, function (req, res) {
    //console.log("id ITEM: " + req.body.item_id);
    db_conf.db.oneOrNone(' update carrito set unidades_carrito = unidades_carrito - 1 ' +//from usuarios, articulos ' +
        'where id_articulo=$1 and id_usuario=$2 and carrito.unidades_carrito > 1 and carrito.estatus = $3 returning id_articulo', [
        numericCol(req.body.item_id),
        numericCol(req.user.id), //numericCol(req.body.user_id)
        req.body.estatus
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: (data ? 'Se ha eliminado una unidad del artículo: ' + data.id_articulo : 'Solo queda una unidad del artículo: ' + data.id_articulo)
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ha ocurrido un error'
        })
    });
});

router.post('/carrito/rem', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from carrito where id_usuario=$1 and id_articulo_unidad=$2 returning id_articulo', [
        req.user.id, //req.body.user_id,
        req.body.item_id
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'El producto ' + data.id_articulo + ' se ha removido del carrito'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al remover el producto del carrito'
        });
    });
});

// Carrito Sell
router.post('/carrito/sell', isAuthenticated, function (req, res) {
    console.log(req.body);
    // Si el usuario no es administrador, se asigna su id y la fecha y hora actual.
    var user_sale_id = req.user.id
    var sale_date = new Date()
    var sale_time = new Date().toLocaleTimeString()
    var cred = numericCol(req.body.optradio === 'cred')
    var id_papel = 0
    if (req.user.permiso_administrador) {
        // Si el usuario es administrador el ID de la venta es el que el asigna. Y la fecha y hora igual.
        user_sale_id = req.body.user_sale;
        sale_date = req.body.fecha_venta;
        sale_time = req.body.hora_venta;
    }
    db_conf.db.tx(function (t) {
        return t.batch([
            t.manyOrNone(
                'select * from carrito, articulos where carrito.id_articulo = articulos.id and ' +
                ' carrito.id_usuario = $1 order by articulo', [
                    numericCol(req.user.id) //numericCol(req.body.user_id)
                ]),
            t.one('select * from usuarios where id = $1', [
                user_sale_id
            ])
        ]).then(function (data) {
            id_papel = data[1].id_tienda
            if (req.user.permiso_administrador) {
                id_papel = req.body.id_papel
            }
            console.log('ID TIENDA VENTA: ' + data[1].id_tienda);
            return t.batch([
                data[0],
                t.one('insert into ventas (id_nota, id_tienda, id_usuario, precio_venta, estatus,  id_papel)  ' +
                    'values( (select coalesce(max(id_nota), 0) from ventas where id_tienda = $1 ) + 1 ,' +
                    '$1, $2, $3, $4, $5) returning id', [
                    numericCol(data[1].id_tienda),
                    numericCol(user_sale_id),
                    numericCol(req.body.precio_tot),
                    "activa",
                    id_papel //req.body.id_papel
                ])
            ]);
        }).then(function (data) {
            var queries = [];
            // Agregar anotaciones
            if (req.body.anotacion !== "") {
                queries.push(t.one('insert into anotaciones (id_venta, fecha, texto) values ($1, $2, $3) returning id', [
                    data[1].id,
                    req.body.fecha_venta,
                    req.body.anotacion
                ]))
            }


            /*
             * Agregar transferencia
             */
            queries.push(t.one('insert into transferencia (id_venta, monto_efectivo, monto_credito, monto_debito, id_terminal, ' +
                '  fecha, hora, id_papel, motivo_transferencia) values($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id', [
                data[1].id,
                req.body.monto_efec,
                (numericCol(req.body.monto_rec) - numericCol(req.body.monto_efec)) * cred,
                (numericCol(req.body.monto_rec) - numericCol(req.body.monto_efec)) * (1 - cred),
                req.body.terminal,
                req.body.fecha_venta,
                req.body.hora_venta,
                req.body.id_papel,
                'venta'
            ]))
            /*
             * Venta artículos
             */
            for (var i = 0; i < data[0].length; i++) {
                var monto_por_pagar = numericCol(numericCol(data[0][i].unidades_carrito) * numericCol(data[0][i].precio) -
                    numericCol(data[0][i].discount) - numericCol(data[0][i].monto_pagado)) === null ? 0 :
                    numericCol(numericCol(data[0][i].unidades_carrito) * numericCol(data[0][i].precio) -
                        numericCol(data[0][i].discount) - numericCol(data[0][i].monto_pagado));
                // Aquí precio es el precio de venta del artículo
                // for(var k = 0; k < data[0][i].unidades_carrito; k++){
                queries.push(
                    t.one('insert into venta_articulos (id_venta, id_articulo, unidades_vendidas, discount, estatus, ' +
                        ' precio, id_articulo_unidad, fue_sol) ' +
                        ' values($1, $2, $3, $4, $5, $6, $7, $8) returning id, id_articulo', [
                        numericCol(data[1].id),
                        numericCol(data[0][i].id_articulo),
                        1, // numericCol(data[0][i].unidades_carrito),
                        numericCol(data[0][i].discount),
                        data[0][i].estatus,
                        data[0][i].carrito_precio / numericCol(data[0][i].unidades_carrito),
                        data[0][i].id_articulo_unidad, //numericCol(data[0][i].id_articulo) + '-' + k
                        data[0][i].estatus === "solicitada" ? 1 : 0
                    ])
                );
                // }
                queries.push(t.none('delete from carrito where id_usuario=$1 and id_articulo=$2', [
                    numericCol(data[0][i].id_usuario),
                    numericCol(data[0][i].id_articulo)
                ]));

                // Si la prenda no está en inventarios, no hay necesidad de decrementar las existencias.
                if (data[0][i].estatus !== "solicitada") {
                    queries.push(t.one('update articulos set n_existencias = n_existencias - $2 where id = $1 returning id', [
                        numericCol(data[0][i].id_articulo),
                        numericCol(data[0][i].unidades_carrito),
                        new Date()
                    ]));
                }

                // Siempre pagar a proveedor a menos de que la prenda sea solicitada
                if (data[0][i].estatus !== "solicitada") {
                    queries.push(t.oneOrNone('update proveedores set a_cuenta = a_cuenta + $2, por_pagar = por_pagar - $2 where id = $1 returning id', [
                        numericCol(data[0][i].id_proveedor),
                        numericCol(data[0][i].costo * data[0][i].unidades_carrito)
                    ]));
                    queries.push(t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                        ' values($1, $2, $3, $4, $5) returning id', [
                        numericCol(data[0][i].id_proveedor),
                        'abono',
                        req.body.fecha_venta,
                        'venta de mercancía, nota: ' +   req.body.id_papel,
                        numericCol(data[0][i].costo * data[0][i].unidades_carrito)
                    ]))
                    /*
                    * Agregar transacción con proveedor
                    * */
                    queries.push(t.one('insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                        ' values($1, $2, $3, $4, $5) returning id', [
                        numericCol(data[0][i].id_proveedor),
                        'cargo',
                        req.body.fecha_venta,
                        'venta de mercancía, nota: ' +   req.body.id_papel,
                        - numericCol(data[0][i].costo * data[0][i].unidades_carrito)
                    ]))
                }

                // Agregar prenda solicitada a inventario de prendas solicitadas
                if (data[0][i].estatus === "solicitada") {
                    queries.push(
                        t.oneOrNone(" insert into articulos_solicitados (id_venta, id_articulo, " +
                            " id_articulo_unidad, n_solicitudes, costo_unitario, estatus) values " +
                            " ($1, $2, $3, $4, $5, 'no ingresada') returning id", [
                            numericCol(data[1].id),
                            data[0][i].id_articulo,
                            data[0][i].id_articulo_unidad,
                            1,
                            data[0][i].costo
                        ])
                    )
                }
            }
            return t.batch([data, queries]);
        })
    }).then(function (data) {
        console.log('Venta generada: ', data);
        res.json({
            status: 'Ok',
            message: 'La venta ha sido registrada exitosamente'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrio un error'
        })
    });
});

// Insertar prenda en carrito
router.post('/carrito/new', isAuthenticated, function (req, res) {
    console.log(req.body);
    // Agregar a carrito

    db_conf.db.one('select count(*) as unidades_carrito from carrito where id_articulo = $1 and id_usuario = $2', [
        numericCol(req.body.item_id),
        numericCol(req.user.id),//numericCol(req.body.user_id)
        req.body.id_estatus // Debe ser posible agregar el mismo artículo al carrito si el estatus de uno es distinto del otro.
    ]).then(function (data) {
        if (data.unidades_carrito > 0) {
            console.log('La prenda ya está en el carrito');
            res.json({
                status: 'Ok',
                message: 'La prenda ya está en el carrito'
            });

        } else {
            //var discount = req.body.optradioDesc;
            //if(discount == 'otro'){
            //    discount = (1 - numericCol(req.body.precio_pagado)/numericCol(req.body.item_precio))*100;
            //    console.log('DISCOUNT:'  + discount);
            //}
            // Absolut discount
            var query = []
            var discount = numericCol(req.body.item_precio) - numericCol(req.body.precio_pagado)
            console.log('DISCOUNT: ' + discount);
            for (var i = 0; i < req.body.existencias; i++) {
                query.push(
                    db_conf.db.oneOrNone('insert into carrito (fecha, id_articulo, id_usuario, discount,  ' +
                        'unidades_carrito, estatus, monto_pagado, carrito_precio, id_articulo_unidad) ' +
                        ' values($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id_articulo', [
                        new Date(),
                        numericCol(req.body.item_id),
                        numericCol(req.user.id),//numericCol(req.body.user_id),
                        discount,
                        1, // req.body.existencias,
                        req.body.id_estatus,
                        numericCol(req.body.precio_pagado),
                        numericCol(req.body.precio_pagado),
                        req.body.item_id + '-' + i
                    ])
                )
            }
            query.push(
                db_conf.db.oneOrNone('select * from articulos where id = $1', [
                    req.body.item_id
                ])
            )
            db_conf.db.task(function (t) {
                return this.batch(query)
            }).then(function (data) {
                console.log('Artículo añadido al carrito');
                res.json({
                    status: 'Ok',
                    message: 'La prenda con modelo: "' + data[1].modelo + '" ha sido registrada en el carrito'
                });
            }).catch(function (error) {
                console.log(error);
                res.json({
                    status: 'Error',
                    message: 'Ocurrió un error'
                });
            });

        }
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al agregar al carrito'
        });
    });

});

// New item
router.post('/item/new', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone('select * from marcas')
        ]);
    }).then(function (data) {
        res.render('partials/items/new-item', {tiendas: data[0], marcas: data[2], proveedores: data[1]});
    }).catch(function (error) {
        console.log(error);
    });
});

// Display de objetos para venta
router.post('/item/list/sale', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from articulos as count '),
            this.manyOrNone('select * from articulos order by articulo limit $1 offset $2', [pageSize, offset]),
            this.manyOrNone('select * from terminales'),
            this.manyOrNone('select articulo, proveedores.nombre as nombre_prov, n_existencias, ' +
                ' tiendas.nombre as nombre_tienda, precio, modelo, nombre_imagen, descripcion, articulos.id as id, ' +
                ' articulos.id_tienda ' +
                ' from articulos, proveedores, tiendas where id_proveedor = proveedores.id and id_tienda = tiendas.id order by articulo limit $1 offset $2', [pageSize, offset])
        ]);

    }).then(function (data) {
        console.log("NEW DATA");
        console.log(data[3]);
        res.render('partials/items/sale-item-list', {
            items: data[1],
            user: req.user,
            terminales: data[2],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize),
            itemProv: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de notas
router.post('/notes/list/', isAuthenticated, function (req, res) {
    console.log(req.body)
    var pageSize = 10;
    var offset = req.body.page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from ventas as count where ' +
                'id_tienda = $1 and id_papel = $2',
                [req.body['data[1][value]'], req.body['data[0][value]']]),
            this.manyOrNone(" select ventas.id as id_venta, ventas.id_papel, ventas.precio_venta from ventas, transferencia where estatus = $4 and id_tienda = $1 and ventas.id_papel = $5 and " +
                " transferencia.id_venta = ventas.id and transferencia.motivo_transferencia = 'venta' and fecha <= $7 and " +
                " fecha >= $6 " +
                " order by ventas.id desc limit $2 offset $3 ",
                [req.body['data[1][value]'],
                    pageSize,
                    offset,
                    "activa",
                    req.body['data[0][value]'],
                    req.body['data[2][value]'],
                    req.body['data[3][value]']])
        ]);
    }).then(function (data) {
        res.render('partials/notes/notes-list', {
            status: 'Ok',
            count: data[0],
            sales: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Display de notas
router.post('/notes-partials/list/', isAuthenticated, function (req, res) {
    console.log(req.body)
    var pageSize = 10;
    var offset = req.body.page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*)  as count from transferencia, ventas where ' +
                'transferencia.id_venta = ventas.id and ventas.id_tienda = $1 and transferencia.id_papel = $2',
                [req.body['data[1][value]'], req.body['data[0][value]']]),
            this.manyOrNone(" select ventas.id as id_venta, transferencia.id_papel, ventas.precio_venta from ventas, " +
                " transferencia where estatus = $4 and id_tienda = $1 and transferencia.id_papel = $5 and " +
                " transferencia.id_venta = ventas.id and fecha <= $7 and " +
                " fecha >= $6 " +
                " order by ventas.id desc limit $2 offset $3 ",
                [req.body['data[1][value]'],
                    pageSize,
                    offset,
                    "activa",
                    req.body['data[0][value]'],
                    req.body['data[2][value]'],
                    req.body['data[3][value]']])
        ]);
    }).then(function (data) {
        console.log('COUNT')
        console.log(data[0])
        res.render('partials/notes/notes-list', {
            status: 'Ok',
            count: data[0],
            sales: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de notas para imprimir
router.post('/print/notes/list/', isAuthenticated, function (req, res) {
    console.log(req.body);
    var pageSize = 10;
    var offset = req.body.page * pageSize;
    var query = 'select ventas.id as ventaId, monto_pagado_tarjeta, precio_venta, fecha_venta, ' +
        ' hora_venta, tiendas.nombre as nombreTienda, saldo_pendiente, unidades_vendidas, discount, monto_pagado_tarjeta,' +
        ' monto_pagado, monto_por_pagar, id_venta, venta_articulos.estatus as estatusPrenda, articulos.articulo as nombreArt, ' +
        ' modelo, proveedores.nombre as nombreProv ' +
        ' from ventas, tiendas, venta_articulos, articulos, proveedores where ventas.estatus = $4 and ventas.id = venta_articulos.id_venta ' +
        ' and ventas.id_tienda = tiendas.id and articulos.id = venta_articulos.id_articulo and articulos.id_proveedor = ' +
        ' proveedores.id' +
        ' order by ventaId desc limit $2 offset $3';
    if (req.body.data[0]['value']) { ///// FIX
        switch (req.user.permiso_administrador) {
            case true:
                query = "select ventas.id, ventas.id_nota, ventas.precio_venta, ventas.saldo_pendiente, ventas.fecha_venta, ventas.hora_venta, ventas.id_tienda, tiendas.nombre, ventas.id_papel " +
                    "from ventas, tiendas  " +
                    "where (((ventas.fecha_venta >= $5 and ventas.fecha_venta <= $6) and ventas.id_nota = $7) " +
                    " or ((ventas.fecha_venta >= $5 and ventas.fecha_venta <= $6) and ventas.id_papel = $10)) and ventas.id_tienda = tiendas.id and ventas.id_tienda=$9";
                break;
            default:
                query = "select ventas.id, ventas.id_nota, ventas.precio_venta, ventas.saldo_pendiente, ventas.fecha_venta, ventas.hora_venta, ventas.id_tienda, tiendas.nombre, ventas.id_papel " +
                    "from ventas, tiendas " +
                    "where ((ventas.fecha_venta >= $5 and ventas.fecha_venta <= $6) and ventas.id_nota = $7) and ventas.id_usuario = $8 and ventas.id_tienda = tiendas.id and ventas.id_tienda=$9";
        }
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from ventas as count'),
            // Lista ventas y tiendas físicas
            this.manyOrNone(query, [
                req.user.id,
                pageSize,
                offset,
                "activa",
                req.body.data[3]['value'],//fecha_inicial,
                req.body.data[4]['value'],//fecha_final,
                req.body.data[0]['value'],//id_note, //¿id de venta? checar
                req.user.id,
                req.body.data[2]['value'],//id_tienda,
                req.body.data[1]['value']]//id_papel]
            )
        ]);
    }).then(function (data) {
        res.render('partials/notes/print-notes-list', {
            status: 'Ok',
            count: data[0],
            sales: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de objetos
router.post('/item/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from articulos as count '),
            this.manyOrNone('select articulos.id as id_articulo, articulo, descripcion, modelo, precio, n_existencias,' +
                ' proveedores.nombre as nombre_proveedor, articulos.id_tienda, tiendas.nombre as nombre_tienda from articulos, proveedores, tiendas  where ' +
                ' tiendas.id = articulos.id_tienda and articulos.id_proveedor = proveedores.id ' +
                ' order by articulo limit $1 offset $2', [pageSize, offset])
        ]);

    }).then(function (data) {
        res.render('partials/items/item-list', {
            status: 'Ok',
            items: data[1],
            pageNumber: req.body.page,
            user: req.user,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Display de sucursales
router.post('/store/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from tiendas as count'),
            this.manyOrNone('select * from tiendas order by nombre limit $1 offset $2', [pageSize, offset])
        ]);

    }).then(function (data) {
        res.render('partials/stores/store-list', {
            status: 'Ok',
            stores: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de terminales
router.post('/terminal/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from terminales as count'),
            this.manyOrNone('select * from terminales order by nombre_facturador limit $1 offset $2', [pageSize, offset])
        ]);

    }).then(function (data) {
        res.render('partials/terminals/terminals-list', {
            status: 'Ok',
            terminals: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de bonos
router.post('/bonus/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from bonos as count'),
            this.manyOrNone('select * from bonos order by nombre limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/bonus-list', {
            status: 'Ok',
            bonos: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de premios
router.post('/prize/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from premios as count'),
            this.manyOrNone('select * from premios order by nombre limit $1 offset $2 ', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/prize-list', {
            status: 'Ok',
            premios: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>')
    })
})

// Display de préstamos
router.post('/lending/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from prestamos as count'),
            this.manyOrNone('select prestamos.id as id, prestamos.monto as monto, prestamos.descripcion as descripcion, ' +
                ' prestamos.fecha_liquidacion as fecha_liquidacion, prestamos.fecha_prestamo as fecha_prestamo ' +
                ' from prestamos, usuarios where usuarios.id = prestamos.id_usuario order by fecha_prestamo limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        console.log('Prestamos: ', data.length);
        res.render('partials/lending-list', {
            status: 'Ok',
            lendings: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de pagos extra
router.post('/extra-pay/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from pagos_extra as count'),
            this.manyOrNone('select pagos_extra.id as id, pagos_extra.monto as monto, pagos_extra.descripcion as descripcion, pagos_extra.fecha_pago_extra as fecha_pago_extra, ' +
                'nombres from pagos_extra, usuarios where usuarios.id = pagos_extra.id_usuario order by fecha_pago_extra, nombres limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        console.log('Pagos extra: ', data.length);
        res.render('partials/extra-pay-list', {
            status: 'Ok',
            extra_pays: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de penalizaciones
router.post('/penalization/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from penalizaciones as count'),
            this.manyOrNone('select * from penalizaciones order by nombre limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/penalization-list', {
            status: 'Ok',
            penalizations: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Display de marcas
router.post('/marca/list/', isAuthenticated, function (req, res) {
    var pageSize = 10;
    var offset = req.body.page * pageSize;

    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from marcas as count'),
            this.manyOrNone('select * from marcas order by nombre limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/marcas-list', {
            status: 'Ok',
            marcas: data[1],
            pageNumber: req.body.page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.get('/notes/getbyid/:id', isAuthenticated, function (req, res) {
    const id = numericCol(req.params.id);
    console.log(id);
    db_conf.db.task(function (t) {

        return this.batch([
            this.one('select * from ventas where ventas.id = $1 ', [id]),
            this.manyOrNone('select * from venta_articulos, articulos where venta_articulos.id_venta = $1 and ' +
                'venta_articulos.id_articulo = articulos.id', [id])
        ]).then(function (data) {

            return t.batch([
                data[0],
                t.one('select * from tiendas where id = $1 ', data[0].id_tienda),
                t.one('select * from usuarios where id = $1', data[0].id_usuario),
                data[1],
                t.oneOrNone('select * from terminales where id = $1', data[0].id_terminal)
            ]);

        });

    }).then(function (data) {

        res.render('partials/notes/ticket', {
            venta: data[0],
            tienda: data[1],
            usuario: data[2],
            articulos: data[3],
            terminal: data[4]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});

// Load sales data into  modal.
router.post('/notes/edit-note/', isAuthenticated, function (req, res) {
    var id = req.body.sales_id;
    var user_id = req.body.user_id;

    console.log('user_id: ', user_id);
    console.log('sale_id: ', id);

    db_conf.db.task(function (t) {

        return this.batch([
            this.oneOrNone(
                'select * from ventas where id=$1 and id_usuario=$2', [
                    numericCol(id),
                    numericCol(user_id)
                ]),
            this.oneOrNone(
                'select sum(unidades_vendidas) as sum from venta_articulos where id_venta=$1',
                [numericCol(id)]
            ),
            this.manyOrNone(
                'select * from venta_articulos where id_venta=$1',
                [numericCol(id)]
            ),
            this.oneOrNone(
                'select * from usuarios where id=$1',
                [numericCol(user_id)]
            )
        ]).then(function (data) {

            var identifiers = [];
            for (var i = 0; i < data[2].length; i++) {  // data[2] -> Artículos
                identifiers.push(data[2][i].id_articulo);
            }
            //console.log('Artículos: ', identifiers);

            return t.batch([
                {venta: data[0]}, //venta
                {total_unidades: data[1]}, //unidades vendidas
                {articulos: data[2]}, //artículos vendidos
                {vendedor: data[3]}, //vendedor
                t.manyOrNone('select * from articulos where id IN ($1:csv)', [identifiers])
            ]);


        })

    }).then(function (data) {
        //console.log("Length data: " + JSON.stringify(data[1][0]));
        res.render('partials/notes/edit-note', {
            status: 'Ok',
            sale: data[0].venta,
            n_items_sale: data[1].total_unidades,
            items_sale: data[2].articulos,
            user: data[3].vendedor,
            items: data[4]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Load store data into  modal.
router.post('/store/edit-store/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.one('select * from tiendas where id = $1', [id]).then(function (data) {
        console.log('Editar tienda: ', data.nombre);
        res.render('partials/stores/edit-store', {
            status: 'Ok',
            store: data
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load terminal data into  modal.
router.post('/terminal/edit-terminal/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    console.log(id);
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select * from terminales where id = $1', [id]),
            this.manyOrNone('select * from tiendas')
        ])
    }).then(function (data) {
        res.render('partials/terminals/edit-terminal', {
            status: 'Ok',
            terminal: data[0],
            tiendas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load bonus data into  modal.
router.post('/bonus/edit-bonus/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select * from bonos where id = $1', [
                id
            ]),
            this.manyOrNone('select * from tiendas')
        ])
    }).then(function (data) {
        console.log('Editar bono: ', data.id);
        res.render('partials/edit-bonus', {bonus: data[0], tiendas: data[1]});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load prize data into modal
router.post('/prize/edit-prize', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.batch([
            this.oneOrNone('select * from premios where id = $1', [
                req.body.id
            ]),
            this.manyOrNone('select * from tiendas')
        ])
    }).then(function (data) {
        res.render('partials/edit-prize', {prize: data[0], tiendas: data[1]});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>')
    });
});

// Load bonus data into  modal.
router.post('/lending/edit-lending/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.task(function (t) {
        return this.batch([
            this.oneOrNone('select prestamos.id as id, prestamos.monto as monto, prestamos.pago_semanal as pago_semanal, ' +
                'prestamos.descripcion as descripcion, prestamos.fecha_prestamo as fecha_prestamo, prestamos.fecha_liquidacion as fecha_liquidacion,' +
                ' prestamos.id_usuario as id_usuario from prestamos, usuarios where prestamos.id_usuario = usuarios.id and prestamos.id = $1 ', [
                id
            ]),
            this.manyOrNone('select * from usuarios')
        ])
    }).then(function (data) {
        res.render('partials/edit-lending', {
            status: 'Ok',
            lendings: data[0],
            usuarios: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Load bonus data into  modal.
router.post('/extra-pay/edit-extra-pay/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.task(function (t) {
        return this.batch([
            this.oneOrNone('select pagos_extra.id as id, pagos_extra.monto as monto,  ' +
                'pagos_extra.descripcion as descripcion, pagos_extra.fecha_pago_extra as fecha_pago_extra,' +
                ' pagos_extra.id_usuario as id_usuario from pagos_extra, usuarios where pagos_extra.id_usuario = usuarios.id and pagos_extra.id = $1 ', [
                id
            ]),
            this.manyOrNone('select * from usuarios')
        ])
    }).then(function (data) {
        console.log(data);
        res.render('partials/edit-extra-pay', {
            status: 'Ok',
            extra_pays: data[0],
            usuarios: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Load penalization data into  modal.
router.post('/penalization/edit-penalization/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.one('select * from penalizaciones where id = $1', [
        id
    ]).then(function (data) {
        res.render('partials/edit-penalization', {
            status: 'Ok',
            penalization: data
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load brand data into  modal.
router.post('/brand/edit-brand/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.one('select * from marcas where id = $1', [id]).then(function (data) {
        res.render('partials/edit-brand', {marca: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load supplier data into modal
router.post('/supplier/edit-supplier/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.task(function (t) {
        // a cuenta y por pagar considerados
        return t.batch([
            db_conf.db.one('select * from proveedores where id = $1', [id]),
            db_conf.db.oneOrNone('select sum(monto) as por_pagar from transacciones_por_pagar where ' +
                ' id_proveedor = $1 ', [id]),
            db_conf.db.oneOrNone('select sum(monto) as a_cuenta from transacciones_a_cuenta where ' +
                ' id_proveedor = $1 ', [id])
        ])
    }).then(function (data) {
        res.render('partials/suppliers/edit-supplier', {
            status: 'Ok',
            supplier: data[0],
            por_pagar: data[1],
            a_cuenta: data[2]
        });
    }).catch(function (error) {

        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load user data into modal
router.post('/user/edit-user/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    db_conf.db.task(function (t) {
        return t.batch([
            db_conf.db.one('select * from usuarios where id = $1', [id]),
            db_conf.db.manyOrNone('select * from tiendas')
        ])
    }).then(function (data) {
        res.render('partials/users/edit-user', {
            status: 'Ok',
            user: data[0],
            tiendas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load item data into modal
router.post('/item/edit-item/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    console.log(id);
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select * from articulos where id = $1', [id]),
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone('select * from marcas')
        ]);
    }).then(function (data) {
        res.render('partials/items/edit-item', {
            status: 'Ok',
            item: data[0],
            tiendas: data[1],
            proveedores: data[2],
            marcas: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Load item data into modal
router.post('/item/return-item/', isAuthenticated, function (req, res) {
    var id = req.body.id;
    console.log(id);
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select * from articulos where id = $1', [id]),
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone('select * from marcas')
        ]);
    }).then(function (data) {
        res.render('partials/items/return-item', {
            status: 'Ok',
            item: data[0],
            tiendas: data[1],
            proveedores: data[2],
            marcas: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/supplier/new', isAuthenticated, function (req, res) {
    res.render('partials/suppliers/new-supplier');
});

router.post('/type/payment', function (req, res) {
    console.log(req.body)
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select * from terminales order by nombre_facturador '),
            this.manyOrNone('select sum(monto_pagado) as sum from carrito, articulos, usuarios where carrito.id_articulo = articulos.id and ' +
                ' carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1', [req.user.id]),
            this.manyOrNone('select sum(carrito_precio) as sum from carrito, usuarios where  ' +
                ' carrito.id_usuario = usuarios.id and carrito.unidades_carrito > 0 and usuarios.id = $1 ', [req.user.id]),
            this.manyOrNone('select * from usuarios')
        ]);
    }).then(function (data) {
        console.log("PRECIO TOT: " + data[2][0].sum);
        res.render('partials/type-payment', {
            status: "Ok",
            user: req.user,
            terminales: data[0],
            total: data[1],
            precio: data[2],
            permiso: req.user.permiso_administrador,
            users: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/supplier/supplier-to-pay', isAuthenticated, function (req, res) {
    console.log(req.body)
    db_conf.db.task(function(t) {
        return this.batch([
            db_conf.db.oneOrNone("select * from proveedores where id = $1", [
                req.body.id
            ]),
            db_conf.db.oneOrNone('select sum(monto) as por_pagar from transacciones_por_pagar where ' +
                ' id_proveedor = $1 ',[
                 req.body.id
                ]),
            db_conf.db.oneOrNone('select sum(monto) as a_cuenta from transacciones_a_cuenta where ' +
                ' id_proveedor = $1 ',[
                req.body.id
            ])
        ])
    }).then(function (data) {
        console.log(data)
        res.render('partials/suppliers/supplier-to-pay', {
            prov: data[0],
            por_pagar: data[1],
            a_cuenta: data[2]
        })
    }).catch(function (error) {
        console.log(error)
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al cargar los proveedores'
        })
    })
})


router.post('/supplier/payment', isAuthenticated, function (req, res) {
    console.log('INSIDE PAYMENT');
    console.log(req.body)
    db_conf.db.oneOrNone('select * from proveedores where id = $1', [
        req.body.id
    ]).then(function (data) {
        console.log('Por pagar: ' + data.por_pagar)
        db_conf.db.task(function (t) {
            return this.batch([
                db_conf.db.oneOrNone(' update proveedores set por_pagar = por_pagar + $2 ' +
                    ' where id = $1 returning id', [
                    req.body.id,
                    req.body.monto_pago
                ]),
                db_conf.db.one(' insert into nota_pago_prov (id_proveedor, monto_pagado, ' +
                    ' fecha, concepto_de_pago) values($1, $2, $3, $4) returning id', [
                    req.body.id,
                    req.body.monto_pago,
                    req.body.fecha_pago,
                    req.body.concepto
                ]),
                db_conf.db.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                    ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                        req.body.id,
                        'abono',
                    req.body.fecha_pago,
                    'pago a proveedores',
                    req.body.monto_pago
                ])
            ])
        })
    }).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se actualizó el saldo del proveedor: '
        })
    }).catch(function (error) {
        console.log(error)
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar el saldo del proveedor'
        })
    })
})


// Listar proveedores
router.post('/supplier/list/pay', isAuthenticated, function (req, res) {
    var page = req.body.page;
    var pageSize = 15;
    var offset = page * pageSize;
    db_conf.db.task(function (t) {
        // a_cuenta and por_pagar contemplado
        return this.batch([
            this.one('select count(*) from proveedores as count'),
            this.manyOrNone('select proveedores.id, nombre, razon_social, rfc, transacciones_a_cuenta.a_cuenta, ' +
                ' transacciones_por_pagar.por_pagar  from proveedores left join (select id_proveedor, sum(monto) as ' +
                ' por_pagar from transacciones_por_pagar group by id_proveedor) as transacciones_por_pagar on ' +
                ' transacciones_por_pagar.id_proveedor = proveedores.id left join (select id_proveedor, sum(monto) ' +
                ' as a_cuenta from transacciones_a_cuenta group by id_proveedor) as transacciones_a_cuenta on ' +
                ' transacciones_a_cuenta.id_proveedor = proveedores.id  order by nombre' +
                ' limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        console.log(data[1])
        res.render('partials/suppliers/supplier-list-pay', {
            status: "Ok",
            suppliers: data[1],
            pageNumber: page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


// Listar proveedores
router.post('/supplier/list/', isAuthenticated, function (req, res) {
    var page = req.body.page;
    var pageSize = 15;
    var offset = page * pageSize;
    db_conf.db.task(function (t) {
        // a_cuenta and por_pagar contemplado
        return this.batch([
            this.one('select count(*) from proveedores as count'),
            this.manyOrNone('select proveedores.id, nombre, razon_social, rfc, transacciones_a_cuenta.a_cuenta, ' +
                ' transacciones_por_pagar.por_pagar  from proveedores left join (select id_proveedor, sum(monto) as ' +
                ' por_pagar from transacciones_por_pagar group by id_proveedor) as transacciones_por_pagar on ' +
                ' transacciones_por_pagar.id_proveedor = proveedores.id left join (select id_proveedor, sum(monto) ' +
                ' as a_cuenta from transacciones_a_cuenta group by id_proveedor) as transacciones_a_cuenta on ' +
                ' transacciones_a_cuenta.id_proveedor = proveedores.id  order by nombre' +
                ' limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/suppliers/supplier-list-pay', {
            status: "Ok",
            suppliers: data[1],
            pageNumber: page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

// Listar usuarios
router.post('/user/list/', isAuthenticated, function (req, res) {
    var page = req.body.page;
    var pageSize = 10;
    var offset = page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            this.one('select count(*) from usuarios as count'),
            this.manyOrNone('select * from usuarios order by usuario limit $1 offset $2', [pageSize, offset])
        ]);
    }).then(function (data) {
        res.render('partials/users/user-list', {
            status: "Ok",
            users: data[1],
            pageNumber: page,
            numberOfPages: parseInt((+data[0].count + pageSize - 1) / pageSize)
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/store/new', isAuthenticated, function (req, res) {
    res.render('partials/stores/store');
});


router.post('/terminal/new', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.manyOrNone('select * from tiendas')
    }).then(function (data) {
        res.render('partials/terminals/new-terminal', {tiendas: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/penalization/new', function (req, res) {
    db_conf.db.task(function (t) {
    }).then(function (data) {
        res.render('partials/new-penalization', {});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/bonus/new', function (req, res) {
    db_conf.db.manyOrNone('select * from tiendas').then(function (data) {
        res.render('partials/new-bonus', {tiendas: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/prize/new', function (req, res) {
    db_conf.db.manyOrNone('select * from tiendas').then(function (data) {
        res.render('partials/new-prize', {tiendas: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/lending/new', function (req, res) {
    db_conf.db.manyOrNone('select * from usuarios').then(function (data) {
        res.render('partials/new-lending', {usuarios: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/extra_pay/new', function (req, res) {
    db_conf.db.manyOrNone('select * from usuarios').then(function (data) {
        res.render('partials/new-extra-pay', {usuarios: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/brand/new', isAuthenticated, function (req, res) {
    res.render('partials/new-brand');
});

router.post('/user/new', isAuthenticated, function (req, res) {
    db_conf.db.manyOrNone('select * from tiendas').then(function (data) {
        res.render('partials/users/new-user', {tiendas: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/user/profile', isAuthenticated, function (req, res) {
    var user_id = req.body.user_id;
    db_conf.db.one('select * from usuarios where id = $1', user_id).then(function (user) {
        res.render('partials/users/user-profile', {user: user});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

/*
 * Registro de artículos
 */

function numericCol(x) {
    return (x == '' || isNaN(x)) ? null : x;
}

function stob(str) {
    return (str == 'true')
}

/* uploads */
var multer = require('multer');

var upload = multer({
    dest: path.join(__dirname, '..', 'uploads')
});

router.post('/item/register', upload.single('imagen'), function (req, res) {
    console.log(req.body);
    //console.log(req.file );
    db_conf.db.task(function (t) {
        return this.oneOrNone('select count(*) as count from articulos where id_proveedor = $1 and id_tienda = $2 and' +
            ' modelo = $4 and id_marca = $5 and descripcion = $6', [
            numericCol(req.body.id_proveedor),
            numericCol(req.body.id_tienda),
            req.body.articulo,
            req.body.modelo,
            numericCol(req.body.id_marca),
            req.body.descripcion
        ]).then(function (data) {

            //Si el producto se registró previamente
            if (data.count > 0) {
                //return [{count: data.count}];
                return t.batch([
                    {count: data.count},
                    t.oneOrNone(' update articulos set n_existencias = n_existencias + $1 where id_proveedor = $2 and ' +
                        ' id_tienda = $3 and modelo = $4 and id_marca = $5 and descripcion = $6 returning id', [
                        numericCol(req.body.n_arts),
                        numericCol(req.body.id_proveedor),
                        numericCol(req.body.id_tienda),
                        req.body.modelo,
                        numericCol(req.body.id_marca),
                        req.body.descripcion
                    ])
                ])
            } else {
                //Si el artículo tiene un proveedor, se agrega a la cuenta
                var proveedor = null;
                if (req.body.id_proveedor != null && req.body.id_proveedor != '') {
                    // a_cuenta and por_pagar contemplado
                    proveedor = t.one('update proveedores set a_cuenta = a_cuenta - $2 where id=$1 returning id, nombre', [
                        numericCol(req.body.id_proveedor),
                        numericCol(req.body.costo) * numericCol(req.body.n_arts)
                    ]);
                }
                // retorna los queries
                return t.batch([
                    {count: data.count},
                    t.one('insert into articulos(id_proveedor, id_tienda, articulo, descripcion, id_marca, modelo, ' +
                        ' talla, notas, precio, costo, codigo_barras, nombre_imagen, n_existencias) ' +
                        ' values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, articulo, n_existencias, modelo', [
                        numericCol(req.body.id_proveedor),
                        numericCol(req.body.id_tienda),
                        req.body.articulo,
                        req.body.descripcion,
                        numericCol(req.body.id_marca),
                        req.body.modelo,
                        req.body.talla,
                        req.body.notas,
                        numericCol(req.body.precio),
                        numericCol(req.body.costo)*(1 - req.body.discount/100),
                        numericCol(req.body.codigo_barras),
                        typeof req.file != 'undefined' ? req.file.filename : null,
                        numericCol(req.body.n_arts)
                    ]),
                    proveedor
                ]);
            }
        }).then(function (data) {
            return t.batch([
                data,
                t.one(' insert into nota_entrada(id_nota_registro, id_usuario, id_articulo, ' +
                    ' num_arts, hora, fecha, costo_unitario, concepto, descuento_proveedor) ' +
                    ' values($1, $2, $3, $4, localtime, $8, $5, $6, $7) returning id', [
                    req.body.id_nota_registro,
                    req.user.id,
                    data[1].id,
                    req.body.n_arts,
                    req.body.costo,
                    'ingreso articulos',
                    req.body.discount,
                    req.body.fecha_registro
                ]),
                t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                    ' values($1, $2 ,$3, $4, $5) returning id', [
                    numericCol(req.body.id_proveedor),
                    'cargo',
                    req.body.fecha_registro,
                    `ingreso de ${req.body.n_arts} unidades del modelo ${req.body.modelo}`,
                    - numericCol(req.body.costo) * numericCol(req.body.n_arts)
                ])
            ])
        })
    }).then(function (data) {
        if (data[0][0].count == 0) {
            res.json({
                status: 'Ok',
                message: 'Se ' + (data[0][1].n_existencias == 1 ? 'ha' : 'han') + ' registrado ' + data[0][1].n_existencias + ' existencia' +
                    (data[0][1].n_existencias == 1 ? '' : 's') + '  de la prenda "' + data[0][1].articulo +
                    '" modelo "' + data[0][1].modelo + '" ' + (data[0][2] ? ' del proveedor "' + data[0][2].nombre + '" ' : '')
            });
        } else {
            res.json({
                status: 'Ok',
                message: '¡Precaución! Existe un registro previo de la prenda "' + req.body.articulo + '" en esta tienda | se actualizaron los valores de existencias'
            });
        }
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el artículo'
        });
    });
});
/*
 * Registro de tiendas
 */
router.post('/store/register', isAuthenticated, function (req, res) {

    db_conf.db.oneOrNone('select count(*) as conteo from tiendas where nombre ilike $1', [req.body.nombre]).then(function (data) {

        console.log('data -> ', data);

        if (Number(data.conteo) === 0) {
            db_conf.db.one('insert into tiendas(nombre, rfc, direccion_calle, direccion_numero_int, direccion_numero_ext, ' +
                'direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_pais) ' +
                'values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, nombre ', [
                req.body.nombre,
                req.body.rfc,
                req.body.direccion_calle,
                req.body.direccion_numero_int,
                req.body.direccion_numero_ext,
                req.body.direccion_colonia,
                req.body.direccion_localidad,
                req.body.direccion_municipio,
                req.body.direccion_ciudad,
                req.body.direccion_pais
            ]).then(function (data) {
                res.json({
                    status: 'Ok',
                    message: '¡La tienda "' + data.nombre + '" ha sido registrada!'
                });
            }).catch(function (error) {
                console.log(error);
                res.json({
                    status: 'Error',
                    message: 'Ocurrió un error al registrar la tienda'
                });
            });
        } else {
            console.log({status: Error, message: 'Ya existe otra tienda con ese nombre'});
            res.json({
                status: 'Error',
                message: 'Ya existe otra tienda registrada con ese nombre'
            });
        }

    }).catch(function (error) {
        console.log(error);
        res.status(400).json({
            status: 'Error',
            message: 'Error de conexión con la base de datos'
        });
    })

});


/*
 * Nuevos usuarios
 */

router.post('/user/signup', isAuthenticated, function (req, res) {
    console.log(req.body)
    db_conf.db.one('select count(*) as count from usuarios where usuario =$1', [req.body.usuario]).then(function (data) {

        // 8 char pass
        // no special char in username

        if (req.body.contrasena !== req.body.confirmar_contrasena) {
            return {id: -2};
        }

        if (data.count > 0) {
            return {id: -1};
        }

        return db_conf.db.one('insert into usuarios ( usuario, contrasena, email, nombres, apellido_paterno, apellido_materno, rfc, direccion_calle, direccion_numero_int, ' +
            'direccion_numero_ext, direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_estado, direccion_pais,' +
            'empleado, salario, permiso_tablero, permiso_administrador, permiso_empleados, permiso_inventario, id_tienda, hora_llegada, hora_salida, comision) values' +
            '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25, $26) returning id, usuario ', [
            req.body.usuario.trim(),
            bCrypt.hashSync(req.body.contrasena, bCrypt.genSaltSync(10), null),
            req.body.email,
            req.body.nombres,
            req.body.apellido_paterno,
            req.body.apellido_materno,
            req.body.rfc,
            req.body.direccion_calle,
            req.body.direccion_numero_int,
            req.body.direccion_numero_ext,
            req.body.direccion_colonia,
            req.body.direccion_localidad,
            req.body.direccion_municipio,
            req.body.direccion_ciudad,
            req.body.direccion_estado,
            req.body.direccion_pais,
            stob(req.body.empleado),
            numericCol(req.body.salario),
            stob(req.body.permiso_tablero),
            stob(req.body.permiso_administrador),
            stob(req.body.permiso_empleados),
            stob(req.body.permiso_inventario),
            numericCol(req.body.id_tienda),
            req.body.llegada,
            req.body.salida,
            req.body.comision/100
        ]);


    }).then(function (data) {

        var response = {status: '', message: ''};
        switch (data.id) {
            case -1:
                response.status = 'Error';
                response.message = 'Ya existe un usuario registrado con ese nombre, pruebe uno distinto';
                break;
            case -2:
                response.status = 'Error';
                response.message = 'La contraseña no coincide';
                break;
            default:
                response.status = 'Ok';
                response.message = 'El usuario "' + data.usuario + '" ha sido registrado';
        }

        res.json(response);

    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el nuevo usuario'
        });
    });
});

/*
 * Registro de terminal
 */
router.post('/terminal/register', isAuthenticated, function (req, res) {
    db_conf.db.one('insert into terminales(banco, nombre_facturador, rfc, id_tienda) values($1, $2, $3, $4) returning id, nombre_facturador ', [
        req.body.banco,
        req.body.nombre,
        req.body.rfc,
        req.body.id_tienda
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡La terminal "' + data.id + '" ha sido registrada ' + 'para el facturador "' + data.nombre_facturador + '"!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar la terminal'
        });
    });
});

/*
 * Registro de pago extra
 */
router.post('/employees/extra_pay/register', function (req, res) {
    console.log(req.body);
    db_conf.db.tx(function (t) {
        return this.batch([
            this.one('insert into pagos_extra(id_usuario, monto, descripcion, fecha_pago_extra) ' +
                ' values($1, $2, $3, $4) returning id, monto', [
                req.body.id_usuario,
                numericCol(req.body.monto),
                req.body.desc,
                req.body.fecha_pago_extra
            ]),
            this.one('select * from usuarios where id = $1', req.body.id_usuario)
        ])
    }).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El pago extra de "' + data[0].monto + '" pesos para el usuario "' + data[1].nombres + '" ha sido registrado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el pago extra.'
        });
    });
});

/*
 * Registro de préstamo
 */
router.post('/employees/lending/register', function (req, res) {
    console.log(req.body);
    db_conf.db.tx(function (t) {
        return this.batch([
            this.one('insert into prestamos(id_usuario, monto, descripcion, fecha_prestamo, fecha_liquidacion, pago_semanal) ' +
                ' values($1, $2, $3, $4, $5, $6) returning id, monto', [
                req.body.id_usuario,
                numericCol(req.body.monto),
                req.body.desc,
                req.body.fecha_prestamo,
                req.body.fecha_liquidacion,
                numericCol(req.body.monto_semanal)
            ]),
            this.one('select * from usuarios where id = $1', req.body.id_usuario)
        ])
    }).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El préstamo de "' + data[0].monto + '" pesos para el usuario "' + data[1].nombres + '" ha sido registrado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el préstamo.'
        });
    });
});

/*
 * Registro de bono
 */
router.post('/employees/bonus/register', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('insert into bonos(nombre, monto, descripcion, monto_alcanzar, criterio, temporalidad, id_tienda) ' +
        ' values($1, $2, $3, $4, $5, $6, $7) returning id, nombre', [
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.monto_alcanzar),
        req.body.criterio,
        req.body.temporalidad,
        req.body.id_tienda
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El bono: "' + data.nombre + '" ha sido registrado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el bono.'
        });
    });
});

/*
 * Registro de premio
 */
router.post('/employees/prize/register', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('insert into premios(nombre, monto, descripcion, monto_alcanzar, criterio, temporalidad, id_tienda) ' +
        ' values($1, $2, $3, $4, $5, $6, $7) returning id, nombre ', [
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.monto_alcanzar),
        req.body.criterio,
        req.body.temporalidad,
        req.body.id_tienda
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El premio: "' + data.nombre + '" ha sido registrado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el premio'
        });
    });
});


/*
 * Registro de penalizacion
 */
router.post('/employees/penalization/register', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('insert into penalizaciones(nombre, monto, descripcion, dias_retraso, dias_antes) ' +
        ' values($1, $2, $3, $4, $5) returning id, nombre', [
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.retraso),
        numericCol(req.body.antest)
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡La penalización: "' + data.nombre + '" ha sido registrada!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar la penalización.'
        });
    });
});

/*
 * Registro de marca
 */
router.post('/brand/register', isAuthenticated, function (req, res) {
    db_conf.db.one('insert into marcas(nombre, descripcion) values($1, $2) returning id, nombre', [
        req.body.nombre,
        req.body.descripcion
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡La marca "' + data.nombre + '" ha sido registrada!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar la marca'
        });
    });
});


/*
 * Registro de proveedores
 */
router.post('/supplier/register', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('insert into proveedores(nombre, razon_social, rfc, direccion_calle, direccion_numero_int, direccion_numero_ext, ' +
        'direccion_colonia, direccion_localidad, direccion_municipio, direccion_ciudad, direccion_pais, a_cuenta, por_pagar) ' +
        'values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, nombre ', [
        req.body.nombre,
        req.body.razon_social,
        req.body.rfc,
        req.body.direccion_calle,
        req.body.direccion_numero_int,
        req.body.direccion_numero_ext,
        req.body.direccion_colonia,
        req.body.direccion_localidad,
        req.body.direccion_municipio,
        req.body.direccion_ciudad,
        req.body.direccion_pais,
        0,
        numericCol(req.body.por_pagar)
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El proveedor "' + data.nombre + '" ha sido registrado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registar el usuario'
        });
    });
});

/*
 * Actualizacion de proveedores
 */
router.post('/supplier/update', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update proveedores set nombre=$2, razon_social=$3, rfc=$4, direccion_calle=$5,' +
        'direccion_numero_int=$6, direccion_numero_ext=$7, direccion_colonia=$8, direccion_localidad=$9,' +
        'direccion_municipio=$10, direccion_ciudad=$11, direccion_pais=$12, por_pagar=$14 where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.nombre,
        req.body.razon_social,
        req.body.rfc,
        req.body.direccion_calle,
        req.body.direccion_numero_int,
        req.body.direccion_numero_ext,
        req.body.direccion_colonia,
        req.body.direccion_localidad,
        req.body.direccion_municipio,
        req.body.direccion_ciudad,
        req.body.direccion_pais,
        req.body.a_cuenta,
        req.body.por_pagar
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: '¡El proveedor "' + data.nombre + '" ha sido actualizado!'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registar el usuario'
        });
    });
});

/*
 * Actualización de tiendas
 */
router.post('/store/update', isAuthenticated, function (req, res) {
    db_conf.db.one('update tiendas set nombre=$2, rfc=$3, direccion_calle=$4, direccion_numero_int=$5, direccion_numero_ext=$6, direccion_colonia=$7, direccion_localidad=$8, ' +
        'direccion_municipio=$9, direccion_ciudad=$10, direccion_pais=$11 ' +
        'where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.nombre,
        req.body.rfc,
        req.body.direccion_calle,
        req.body.direccion_numero_int,
        req.body.direccion_numero_ext,
        req.body.direccion_colonia,
        req.body.direccion_localidad,
        req.body.direccion_municipio,
        req.body.direccion_ciudad,
        req.body.direccion_pais
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos de la tienda "' + data.nombre + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del artículo'
        });
    });
});

/*
 * Actualización de terminales
 */
router.post('/terminal/update', isAuthenticated, function (req, res) {
    db_conf.db.one('update terminales set banco=$2, nombre_facturador=$3, id_tienda=$4, rfc=$5 where id=$1 returning id, nombre_facturador ', [
        req.body.id,
        req.body.banco,
        req.body.nombre,
        req.body.id_tienda,
        req.body.rfc
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos de la terminal "' + data.id + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos de la terminal'
        });
    });
});

/*
 * Actualización de marcas
 */
router.post('/brand/update', isAuthenticated, function (req, res) {
    db_conf.db.one('update marcas set nombre=$2, descripcion=$3 where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.marca,
        req.body.descripcion
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos de la marca "' + data.nombre + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos de la marca'
        });
    });
});

/*
 * Actualización de prestamos
 */
router.post('/lendings/update', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update prestamos set id_usuario=$2, monto=$3, descripcion=$4, fecha_prestamo=$5, fecha_liquidacion=$6, pago_semanal=$7 where id=$1 returning id, monto ', [
        req.body.id,
        req.body.id_usuario,
        numericCol(req.body.monto),
        req.body.desc,
        new Date(req.body.fecha_prestamo),
        new Date(req.body.fecha_liquidacion),
        numericCol(req.body.monto_semanal)
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos del préstamo "' + data.id + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del préstamo'
        });
    });
});

/*
 * Actualización de pagos extras
 */
router.post('/extra-pay/update', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update pagos_extra set id_usuario=$2, monto=$3, descripcion=$4, fecha_pago_extra=$5 where id=$1 returning id, monto ', [
        req.body.id,
        req.body.id_usuario,
        numericCol(req.body.monto),
        req.body.desc,
        new Date(req.body.fecha_pago_extra)
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos del pago extra "' + data.id + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del pago extra'
        });
    });
});


/*
 * Actualización de bonos
 */
router.post('/bonus/update', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update bonos set nombre=$2, monto=$3, descripcion=$4, monto_alcanzar=$5, criterio=$6, temporalidad=$7, id_tienda=$8 where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.monto_alcanzar),
        req.body.criterio,
        req.body.temporalidad,
        req.body.id_tienda
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos del bono "' + data.nombre + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del bono'
        });
    });
});

/*
 * Actuzlización de premios
 */
router.post('/prize/update', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one('update premios set nombre=$2, monto=$3, descripcion=$4, monto_alcanzar=$5, criterio=$6, temporalidad=$7, id_tienda=$8 where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.monto_alcanzar),
        req.body.criterio,
        req.body.temporalidad,
        req.body.id_tienda
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos del premio "' + data.nombre + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del premio'
        });
    });
})

/*
 * Actualización de penalizaciones
 */
router.post('/penalization/update', isAuthenticated, function (req, res) {
    db_conf.db.one('update penalizaciones set nombre=$2, monto=$3, descripcion=$4, dias_retraso=$5, dias_antes=$6 where id=$1 returning id, nombre ', [
        req.body.id,
        req.body.nombre,
        numericCol(req.body.monto),
        req.body.desc,
        numericCol(req.body.retraso),
        numericCol(req.body.antest)
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos de la penalización "' + data.nombre + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos de la penalización'
        });
    });
});

/*
 * Actualización de items
 */
router.post('/item/update', upload.single('imagen'), function (req, res) {
    console.log('SALDOS PROVEEDORES');
    console.log(req.body);
    db_conf.db.tx(function (t) {
        return this.batch([
            t.one('select nombre_imagen from articulos where id = $1', [req.body.id]),
            t.one('update articulos set articulo=$2, descripcion=$3, id_marca=$4, modelo=$5, talla=$6, notas=$7, ' +
                ' precio=$8, costo=$9, codigo_barras=$10, nombre_imagen=$11, n_existencias= $12, id_proveedor=$13, ' +
                ' id_tienda=$14 where id=$1 returning id, articulo ', [
                req.body.id,
                req.body.articulo,
                req.body.descripcion,
                numericCol(req.body.id_marca),
                req.body.modelo,
                req.body.talla,
                req.body.notas,
                numericCol(req.body.precio),
                numericCol(req.body.costo),
                numericCol(req.body.codigo_barras),
                typeof req.file != 'undefined' ? req.file.filename : null,
                numericCol(req.body.n_existencias),
                req.body.id_proveedor,
                req.body.id_tienda
            ]),
            // Este a cuenta ya fue modificado a transacciones_a_cuenta
            t.one('update proveedores set a_cuenta = ((a_cuenta - $3) + $2) where id = $1 returning id', [
                req.body.id_proveedor,
                numericCol(req.body.costo_anterior) * numericCol(req.body.existencias_anterior),
                numericCol(req.body.costo) * numericCol(req.body.n_existencias)
            ]),
            t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, current_date, $3, $4)  returning id', [
                req.body.id_proveedor,
                'abono',
                'modificacion de inventario (primera parte)',
                numericCol(req.body.costo_anterior) * numericCol(req.body.existencias_anterior)
            ]),
            t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, current_date, $3, $4) returning id', [
                req.body.id_proveedor,
                'cargo',
                'modificacion de inventario (segunda parte)',
                - numericCol(req.body.costo) * numericCol(req.body.n_existencias)
            ]),
            /*

            t.one(' insert into transacciones (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                numericCol(req.body.id_proveedor),
                'abono',
                'modificacion proveedor en prenda',
                numericCol(req.body.costo_anterior) * numericCol(req.body.existencias_anterior)
            ]),
            t.one(' insert into transacciones (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                numericCol(req.body.id_proveedor),
                'cargo',
                'modificacion proveedor en prenda',
                -numericCol(req.body.costo) * numericCol(req.body.n_existencias)
            ]),
            t.one(' insert into transacciones (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                numericCol(req.body.id_proveedor_anterior),
                'abono',
                'modificacion proveedor en prenda',
                numericCol(req.body.costo_anterior) * numericCol(req.body.existencias_anterior)
            ]),
            t.one(' insert into transacciones (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                numericCol(req.body.id_proveedor),
                'cargo',
                'modificacion proveedor en prenda',
                -numericCol(req.body.costo) * numericCol(req.body.n_existencias)
            ]),*/
            t.one('insert into nota_modificacion (id_articulo, id_usuario, modificacion, hora, fecha) ' +
                ' values($1,$2,$3, localtime, current_date) returning id', [
                req.body.id,
                req.user.id,
                req.body.desc_mod
            ])
        ]);
    }).then(function (data) {

        // borra la imagen anterior
        if (data[0].nombre_imagen) {
            var img_path = path.join(__dirname, '..', 'uploads/', data[0].nombre_imagen);
            fs.unlinkSync(img_path);
            console.log('successfully deleted ' + img_path);
        }
        res.json({
            status: 'Ok',
            message: 'Los datos del articulo "' + data[1].articulo + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del artículo'
        });
    });
});

/*
 * Devolución de items (Solicitados)
 */
router.post('/item/return_sols', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.oneOrNone(" select id_articulo, id_proveedor, costo_unitario " +
        " from articulos_solicitados, articulos where id_registro_entrada = $1 and " +
        " articulos.id = articulos_solicitados.id_articulo ", [
        req.body.nota_registro_entrada
    ]).then(function (data) {
        db_conf.db.task(function (t) {
            return t.batch([
                t.oneOrNone(" update articulos_solicitados set unidades_sin_regresar = unidades_sin_regresar - $1 " +
                    " where id_registro_entrada = $2 returning id", [
                    numericCol(req.body.unidades_devolver),
                    req.body.nota_registro_entrada
                ]),
                t.oneOrNone(" update articulos set n_existencias = n_existencias - $1 where id = $2 returning id", [
                    numericCol(req.body.unidades_devolver),
                    data.id_articulo
                ]),
                t.oneOrNone(" update proveedores set por_pagar = por_pagar + $1 where id = $2 returning id", [
                    numericCol(req.body.unidades_devolver * data.costo_unitario),
                    data.id_proveedor
                ]),
                t.one('insert into devolucion_prov_articulos ("id_articulo" , "id_proveedor", "unidades_regresadas", "fecha", "costo_unitario", "fue_sol") values( ' +
                    '$1, $2, $3, Now(), $4, 1) returning id', [
                    numericCol(data.id_articulo),
                    numericCol(data.id_proveedor),
                    numericCol(req.body.unidades_devolver),
                    numericCol(data.costo_unitario)
                ]),
                t.oneOrNone(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                    'values($1, $2, Now(), $3, $4) returning id', [
                        data.id_proveedor,
                    'abono',
                    'devolución artículos solicitados',
                    numericCol(req.body.unidades_devolver * data.costo_unitario)
                ])
            ])
        })
    }).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se ha registrado la devolución del artículo'
        });
    }).catch(function (error) {
        console.log(error)
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar la devolución'
        })
    })
})


/*
 * Devolución de items (solo mostrar items que no fueron solicitados)
 */
router.post('/item/return', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.tx(function (t) {
        var transac_type = null;
        if(req.body.optradio === 'si'){
            transac_type = t.oneOrNone(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                'values($1, $2, Now(), $3, $4) returning id', [
                req.body.id_proveedor,
                'abono',
                'devolución artículos',
                numericCol(req.body.costo * req.body.n_devoluciones)
            ]);
        }else{
            t.oneOrNone(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                'values($1, $2, Now(), $3, $4) returning id', [
                req.body.id_proveedor,
                'abono',
                'devolución artículos a proveedor',
                numericCol(req.body.costo * req.body.n_devoluciones)
            ])
        }
        return t.batch([
            t.one('update articulos set n_existencias = $2 where id=$1 returning id, articulo', [
                req.body.id,
                numericCol(req.body.n_existencias) - numericCol(req.body.n_devoluciones),
                new Date()
            ]),
            // Este a cuenta ya fue modificado a transacciones_a_cuenta
            t.one('update proveedores set a_cuenta = a_cuenta + $2 where id = $1 returning nombre', [
                numericCol(req.body.id_proveedor),
                numericCol(req.body.costo * req.body.n_devoluciones)
            ]),
            t.one('insert into devolucion_prov_articulos ("id_articulo" , "id_proveedor", "unidades_regresadas", "fecha", "costo_unitario", "fue_sol") values( ' +
                '$1, $2, $3, Now(), $4, 0) returning id', [
                numericCol(req.body.id),
                numericCol(req.body.id_proveedor),
                numericCol(req.body.n_devoluciones),
                numericCol(req.body.costo)
            ]),
            transac_type
        ])
    }).then(function (data) {
        console.log('Devolución: ', data);
        res.json({
            status: 'Ok',
            message: 'Se ha registrado la devolución del artículo: "' + data[0].articulo + '" del proveedor: "' + data[1].nombre + '"'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del artículo'
        });
    });
});

/*
 * Listado ingreso de empelados
 */
router.post('/employee/list/check-in', function (req, res) {
    db_conf.db.manyOrNone(
        'select * from tiendas'
    ).then(function (data) {
        res.render('partials/list_check_in', {'tiendas': data});
    }).catch(function (error) {
        console.log(error)
        res.json({
            message: 'Ocurrió un error al listar las tiendas',
            status: 'Error'
        });
    });
});

/*
 * Ingreso empleados
 */
router.post('/employee/check-in', function (req, res) {
    db_conf.db.one("select count(*) from asistencia where fecha = date_trunc('day', now()) and tipo = 'entrada' and id_usuario = $1", [
        numericCol(req.user.id)
    ]).then(function (data) {
        if (data.count > 0) {
            return null
        }
        return db_conf.db.one('insert into asistencia ("id_usuario", "fecha", "hora", "tipo" ) ' +
            'values($1, $2, $3, $4) returning id', [
            numericCol(req.user.id),
            new Date(),
            new Date().toLocaleTimeString(),
            "entrada"
        ]);
    }).then(function (user) {
        var message = 'El usuario "' + req.user.nombres + '" ya había registrado entrada';
        if (user != null) {
            message = 'Que tengas  un buen día ' + req.user.nombres;
        }
        res.json({
            status: 'Ok',
            message: message
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error a la hora de registrar la entrada'
        });
    });
});


/*
 * Salida empleados
 */
router.post('/employee/check-out', function (req, res) {
    db_conf.db.one("select count(*) from asistencia where fecha = date_trunc('day', now()) and tipo = 'salida' and id_usuario = $1", [
        numericCol(req.user.id)
    ]).then(function (data) {
        if (data.count > 0)
            return null;
        return db_conf.db.one('insert into asistencia ("id_usuario", "fecha", "hora", "tipo" ) ' +
            'values($1, $2, $3, $4) returning id', [
            numericCol(req.user.id),
            new Date(),
            new Date().toLocaleTimeString(),
            "salida"
        ])
    }).then(function (user) {
        var message = 'El usuario "' + req.user.nombres + '" ya había registrado salida. '
        if (user) {
            message = '¡Descansa ' + req.user.nombres + ', nos vemos mañana!';
        }
        res.json({
            status: 'Ok',
            message: message
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error a la hora de registrar la entrada'
        });
    });
});

/*
 * Cancelar nota
 */
router.post('/cancel/note', isAuthenticated, function (req, res) {
    db_conf.db.tx(function (t) {
        return t.batch([
            t.manyOrNone(" select id_articulo, id_articulo_unidad, estatus, id_proveedor, " +
                " costo, precio, unidades_vendidas, fue_sol, max(costo_def) as costo_def from " +
                " (select venta_articulos.id_articulo, id_articulo_unidad, estatus, " +
                " id_proveedor,  costo, articulos.precio, unidades_vendidas, fue_sol, " +
                " case when fue_sol > 0 then costo_unitario else costo end as costo_def " +
                " from venta_articulos, proveedores, nota_entrada, articulos where " +
                " id_venta = $1 and proveedores.id = articulos.id_proveedor and  " +
                " articulos.id = venta_articulos.id_articulo and articulos.id = " +
                " nota_entrada.id_articulo) as temp group by id_articulo, " +
                " id_articulo_unidad, estatus, id_proveedor, costo, precio, " +
                " unidades_vendidas, fue_sol", [
                numericCol(req.body.note_id)
            ]),
            t.one('update ventas set estatus = $2 where id = $1 returning id', [req.body.note_id, "cancelada"])
        ]).then(function (articulos) {
            var queries = [];
            for (var i = 0; i < articulos[0].length; i++) {
                queries.push(
                    t.one('update articulos set n_existencias = n_existencias + $2 where id = $1 returning id, id_proveedor, costo', [
                        articulos[0][i].id_articulo,
                        articulos[0][i].unidades_vendidas
                    ])
                );
            }
            queries.push(articulos[0]);
            return t.batch(queries); // Aquí no puedo accesar viewjo
        }).then(function (data) {
            var proveedores = [];
            for (var i = 0; i < (data.length - 1); i++) {
                // Este a cuenta ya fue modificado a transacciones_a_cuenta... no se usa
                proveedores.push(
                    t.one('update proveedores set a_cuenta = a_cuenta - $2, por_pagar = por_pagar + $2 where id = $1 returning id', [
                        numericCol(data[i].id_proveedor),
                        numericCol(data[i].costo_def) * numericCol(data[data.length - 1][i].unidades_vendidas)
                    ])
                )
                proveedores.push(
                    t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                        ' values($1, $2, Now(), $3, $4) returning id', [
                        numericCol(data[i].id_proveedor),
                        'cargo',
                        'cancelación de nota',
                        -numericCol(data[i].costo_def) * numericCol(data[data.length - 1][i].unidades_vendidas)
                    ])
                )
                proveedores.push(
                    t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, fecha, concepto, monto) ' +
                        ' values($1, $2, Now(), $3, $4) returning id', [
                        numericCol(data[i].id_proveedor),
                        'abono',
                        'cancelación de nota',
                        numericCol(data[i].costo_def) * numericCol(data[data.length - 1][i].unidades_vendidas)
                    ])
                )
            }
            return t.batch(proveedores);
        });
    }).then(function (data) {
        console.log('Nota cancelada: ', data);
        res.json({
            status: 'Ok',
            message: 'Se ha cancelado la nota'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al cancelar la nota'
        });
    });
});


/*
 * Actualización de usuario
 */
router.post('/user/update', isAuthenticated, function (req, res) {
    db_conf.db.one('update usuarios set nombres=$2, apellido_paterno=$3, apellido_materno=$4, rfc=$5, direccion_calle=$6, direccion_numero_int=$7, ' +
        'direccion_numero_ext=$8, direccion_colonia=$9, direccion_localidad=$10, direccion_municipio=$11, direccion_ciudad=$12, direccion_estado= $13,' +
        'direccion_pais=$14, email=$15, id_tienda=$16, salario=$17, empleado=$18, permiso_tablero=$19, permiso_administrador=$20, permiso_empleados=$21, ' +
        'permiso_inventario=$22, hora_llegada = $23, hora_salida = $24, comision = $25 ' +
        'where id = $1 returning id, usuario ', [
        req.body.id,
        req.body.nombres,
        req.body.apellido_paterno,
        req.body.apellido_materno,
        req.body.rfc,
        req.body.direccion_calle,
        req.body.direccion_numero_int,
        req.body.direccion_numero_ext,
        req.body.direccion_colonia,
        req.body.direccion_localidad,
        req.body.direccion_municipio,
        req.body.direccion_ciudad,
        req.body.direccion_estado,
        req.body.direccion_pais,
        req.body.email,
        numericCol(req.body.id_tienda),
        numericCol(req.body.salario),
        stob(req.body.empleado),
        stob(req.body.permiso_tablero),
        stob(req.body.permiso_administrador),
        stob(req.body.permiso_empleados),
        stob(req.body.permiso_inventario),
        req.body.llegada,
        req.body.salida,
        req.body.comision/100
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Los datos del usuario "' + data.usuario + '" han sido actualizados'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al actualizar los datos del usuario'
        });
    });
});

router.post('/user/change-password', isAuthenticated, function (req, res) {
    res.render('partials/users/change-password', {user: {id: req.body.user_id}});
});


router.post('/user/update-password', isAuthenticated, function (req, res) {

    var user_id = req.body.user_id;
    var old_pass = req.body.old_pass;
    var new_pass = req.body.new_pass;
    var confirm_pass = req.body.confirm_pass;

    db_conf.db.one('select id, contrasena from usuarios where id=$1 ', [user_id]).then(function (user) {

        if (!isValidPassword(user, old_pass)) {
            res.json({
                status: "Error",
                message: "Contraseña incorrecta"
            })
        } else if (isValidPassword(user, old_pass) && new_pass == confirm_pass) {

            db_conf.db.one('update usuarios set contrasena = $1 where id =$2 returning id, usuario', [
                bCrypt.hashSync(new_pass, bCrypt.genSaltSync(10), null),
                user.id
            ]).then(function (data) {
                console.log("Usuario " + data.usuario + ": Contraseña actualizada");
                res.json({
                    status: "Ok",
                    message: "Contraseña actualizada"
                });
            }).catch(function (error) {
                console.log(error);
                res.json({
                    status: "Error",
                    message: "Ocurrió un error al actualizar la contraseña"
                });
            });
        } else if (isValidPassword(user, old_pass) && new_pass != confirm_pass) {
            res.json({
                status: "Error",
                message: "La nueva contraseña no coincide"
            })
        }

    }).catch(function (error) {
        console.log(error);
        res.json({
            status: "Error",
            message: "Ha ocurrido un error al actualizar la contraseña"
        })
    })

});

router.post('/reports/', isAuthenticated, function (req, res) {
    db_conf.db.manyOrNone('select * from tiendas').then(function (tiendas) {
        res.render('partials/reports', {tiendas: tiendas});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>')
    });

});

router.get('/reporte/', isAuthenticated, function (req, res) {


    const id_tienda = req.query.id_tienda;
    const startdate = req.query.startdate;
    const enddate = req.query.enddate;

    db_conf.db.task(function (t) {

        // return appropiate queries
        switch (report_type) {
            case 'ventas':
                return this.batch([
                    this.one('select * from tiendas where id = $1', [id_tienda]),
                    this.manyOrNone('select ventas.id_nota, ventas.precio_venta, ventas.fecha_venta, ventas.hora_venta, ' +
                        '(select count(*) from venta_articulos where id_venta = ventas.id) as num_articulos from ventas, terminales where ventas.id_terminal = terminales.id and ' +
                        ' ventas.id_tienda = $1 and fecha_venta >= $2 and fecha_venta <= $3', [id_tienda, startdate, enddate]),
                    this.one('select sum(precio_venta) total from ventas where fecha_venta >= $1 and fecha_venta <= $2', [startdate, enddate]),
                    this.one('select sum(precio_venta) total from ventas where fecha_venta >= $1 and fecha_venta <= $2 and id_terminal is not null', [startdate, enddate])
                ]);
                break;
            case 'proveedores':
                return this.manyOrNone('select * from proveedores');
                break;
            case 'devoluciones':
                return null;
                break;
            case 'asistencia':
                return null;
                break;
        }

    }).then(function (rows) {

        switch (report_type) {
            case 'ventas':
                console.log('Report generated succesfully');
                res.render('reports/sales', {
                    startdate: startdate,
                    enddate: enddate,
                    tienda: rows[0],
                    ventas: rows[1],
                    monto_total: rows[2],
                    monto_tarjetas: rows[3]
                });
                break;
            case 'proveedores':
                console.log('Report generated succesfully');
                res.render('reports/suppliers', {
                    fecha: (new Date()).toLocaleString('es-MX', {timeZone: 'America/Mexico_City'}),
                    proveedores: rows
                });
                break;
            case 'asistencia':
                res.send("<p>En construcción...</p>");
                break;
            case 'devoluciones':
                res.send("<p>En construcción...</p>");
                break;
            default:
                res.send("<p>Reporte no soportado</p>");
        }

    }).catch(function (error) {
        // send error
        console.log(error);
        res.send("<p>Ocurrió un error al generar el reporte</p>");

    });
});

router.post('/item/find-items-ninv-view', isAuthenticated, function (req, res) {

    var query = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda;
    if (req.user.permiso_administrador) {
        query = 'select * from tiendas'
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select id, nombre from proveedores'),
            this.manyOrNone(query)
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items-ninv', {
            proveedores: data[0],
            tiendas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});

router.post('/item/find-items-sol-view', isAuthenticated, function (req, res) {
    var query = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda;
    if (req.user.permiso_administrador) {
        query = 'select * from tiendas'
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select id, nombre from proveedores'),
            this.manyOrNone(query),
            this.manyOrNone('select id_papel from ventas')
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items-sol', {
            proveedores: data[0],
            tiendas: data[1],
            notas: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});


/* Devolucion solicitudes a proveedores */
router.post('/item/find-items-view-sol-prov', isAuthenticated, function (req, res) {
    var query = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda;
    if (req.user.permiso_administrador) {
        query = 'select * from tiendas'
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone("select id, nombre from proveedores"),
            this.manyOrNone(query),
            this.manyOrNone("select id_registro_entrada as id_papel from articulos_solicitados")
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items-sol', {
            proveedores: data[0],
            tiendas: data[1],
            notas: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.render("<b>Error</b>")
    })
});

router.post('/item/find-items-view', isAuthenticated, function (req, res) {
    var query = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda;
    if (req.user.permiso_administrador) {
        query = 'select * from tiendas'
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select id, nombre from proveedores'),
            this.manyOrNone(query)
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items', {
            proveedores: data[0],
            tiendas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});

router.post('/item/find-items-view', isAuthenticated, function (req, res) {

    var query = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda;
    if (req.user.permiso_administrador) {
        query = 'select * from tiendas'
    }

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select id, nombre from proveedores'),
            this.manyOrNone(query)
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items', {
            proveedores: data[0],
            tiendas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});


router.post('/item/find-items-view-inv', isAuthenticated, function (req, res) {

    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select id, nombre from proveedores'),
            this.manyOrNone('select * from marcas')
        ]);
    }).then(function (data) {
        res.render('partials/items/find-items-inv', {
            proveedores: data[0],
            marcas: data[1]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});

router.post('/items/list/back_registers', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone('select distinct id_nota_devolucion from nota_devolucion')
        ])
    }).then(function (data) {
        res.render('partials/items/find-back', {
            tiendas: data[0],
            proveedores: data[1],
            nota_devolucion: data[2]
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            message: 'Ocurrió un error al cargar los registros',
            status: 'Error'
        })
    })
})

router.post('/items/list/item_edits', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores')
        ])
    }).then(function (data) {
        console.log(data)
        res.render('partials/items/find-edits', {
            tiendas: data[0],
            proveedores: data[1]
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            message: 'Ocurrió un error al cargar los registros',
            status: 'Error'
        })
    })
})

router.post('/item/registers/update', isAuthenticated, function (req, res) {
    console.log(req.body)
    db_conf.db.oneOrNone(
        " update nota_entrada set num_arts = $1, costo_unitario = $2, hora = localtime, fecha = $5, " +
        " concepto = 'ingreso articulos' where id = $3 and id_nota_registro = $4 returning id_articulo", [
            req.body.n_arts,
            req.body.costo,
            req.body.unique_id_nota_registro,
            req.body.id_nota_registro,
            req.body.fecha_registro
        ]
    ).then(function (data) {
        console.log('First step: ' + data.id_articulo)
        db_conf.db.task(function (t) {
            return this.batch([
                t.oneOrNone(
                    "select * from articulos where id = $1", [
                        data.id_articulo
                    ]),
                t.oneOrNone(
                    " update articulos set articulo =$1, descripcion = $2, id_marca = $3, " +
                    " modelo = $4, id_tienda = $5, talla = $6, notas = $7,  " +
                    " precio = $8, costo = $9, n_existencias = $10 where id = $11 returning id", [
                        req.body.articulo,
                        req.body.descripcion,
                        req.body.id_marc,
                        req.body.modelo,
                        req.body.id_tienda,
                        req.body.talla,
                        req.body.notas,
                        req.body.precio,
                        req.body.costo,
                        req.body.n_arts,
                        data.id_articulo
                    ])
            ])
        }).then(function (data) {
            console.log(data)
            /*
            db_conf.db.oneOrNone(
                "update proveedores set a_cuenta = (a_cuenta + $1) - $2 where id = $3 returning id", [
                    data[0].n_existencias * data[0].costo,
                    req.body.n_arts * req.body.costo,
                    data[0].id_proveedor
                ])
                */
            // Este a cuenta ya fue tomado en cuenta
            db_conf.db.task(function(t) {
              return this.batch([
                  t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                      ' fecha, concepto, monto) values($1, $2, current_date, $3, $4)  returning id', [
                      data[0].id_proveedor,
                      'abono',
                      'modificacion de inventario (primera parte)',
                      numericCol(data[0].n_existencias * data[0].costo)
                  ]),
                  t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                      ' fecha, concepto, monto) values($1, $2, current_date, $3, $4) returning id', [
                      data[0].id_proveedor,
                      'cargo',
                      'modificacion de inventario (segunda parte)',
                      - numericCol(req.body.n_arts * req.body.costo)
                  ])
              ])
            }).then(function (data) {
                console.log(data)
                res.json({
                    estatus: 'Ok',
                    message: 'Se han actualizado los datos exitosamente'
                })
            }).catch(function (error) {
                console.log(error);
                res.json({
                    estatus: 'Error',
                    message: 'Ocurrió un error al actualizar los datos'
                })
            })
        })
    })
});


router.post('/item/registers/edit', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.task(function (t) {
        return this.batch([
            this.oneOrNone(
                " select nota_entrada.id as unique_id_registro, id_nota_registro, id_articulo, id_tienda, " +
                " id_proveedor, proveedores.nombre as nombre_proveedor, " +
                " tiendas.nombre as nombre_tienda, articulo, descripcion, id_marca, modelo, talla, notas " +
                " precio, costo, codigo_barras, nombre_imagen, num_arts, id_nota_registro  from  " +
                " nota_entrada, proveedores, articulos, tiendas where tiendas.id = articulos.id_tienda " +
                " and articulos.id = nota_entrada.id_articulo and articulos.id_proveedor = proveedores.id " +
                " and nota_entrada.id_nota_registro = $1 and nota_entrada.id = $2 ", [
                    req.body.note_id,
                    req.body.unique_id_register
                ]),
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone('select * from marcas')
        ])
    }).then(function (data) {
        res.render('partials/items/edit-registers', {
            item_data: data[0],
            tiendas: data[1],
            proveedores: data[2],
            marcas: data[3]
        })
    }).catch(function (error) {
        console.log(error)
        res.json({
            message: 'Ocurrió un error al cargar los datos',
            status: 'Error'
        })
    })
})


router.post('/items/list/item_registers', isAuthenticated, function (req, res) {
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone('select * from tiendas'),
            this.manyOrNone('select * from proveedores'),
            this.manyOrNone("select distinct id_nota_registro from nota_entrada where concepto = 'ingreso articulos'")
        ])
    }).then(function (data) {
        res.render('partials/items/find-registers', {
            tiendas: data[0],
            proveedores: data[1],
            nota_entrada: data[2]
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            message: 'Ocurrió un error al cargar los registros',
            status: 'Error'
        })
    })
})

router.post('/back/note_item', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.tx(function (t) {
        return t.manyOrNone('select * from articulos, nota_entrada where articulos.id = nota_entrada.id_articulo and ' +
            ' nota_entrada.id_nota_registro = $1', [
            req.body.id_nota_registro
        ]).then(function (data) {
            var query = []
            for (var i = 0; i < data.length; i++) {
                query.push(t.one('update articulos set n_existencias = n_existencias - ' + data[i].num_arts +
                    ' where id =  ' + data[i].id + ' returning id'))
                /*query.push(t.one('update proveedores set a_cuenta = a_cuenta + ' + data[i].num_arts * data[i].costo +
                    ' where id = ' + data[i].id_proveedor + ' returning id'))*/
                // Este a cuenta ya fue considerado
                query.push(t.one('insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                ' fecha, concepto, monto) values($1, $2, current_date, $3, $4)  returning id', [
                    data[i].id_proveedor,
                    'abono',
                    'devolución de prenda: ' + data[i].modelo,
                    numericCol(data[i].num_arts * data[i].costo)
                ]))
                query.push(t.one('insert into nota_devolucion (id_nota_devolucion, id_articulo, id_usuario, num_arts, ' +
                    ' hora, fecha) values ($1, $2, $3, $4, localtime, current_date) returning id', [
                    data[i].id_nota_registro,
                    data[i].id,
                    req.user.id,
                    data[i].num_arts
                ]))
            }
            return t.batch(query)
        }).then(function (data) {
            return t.manyOrNone('delete from nota_entrada where id_nota_registro = $1 returning id', [
                req.body.id_nota_registro
            ])
        })
    }).then(function (data) {
        console.log(data)
        res.json({
            status: 'Ok',
            message: 'Se ha devuelto la nota exitosamente'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al realizar la devolución'
        })
    })
})

router.post('/search/registers/results_back', isAuthenticated, function (req, res) {
    console.log(req.body);
    query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, precio, modelo, nombre_imagen, " +
        " descripcion, articulos.id as id, tiendas.id as id_tienda, nota_entrada.fecha as fecha, num_arts " +
        " from articulos, proveedores, tiendas, nota_entrada where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and nota_entrada.id_articulo = articulos.id and nota_entrada.id_nota_registro = $5 and " +
        " articulos.id_tienda = tiendas.id and tiendas.id = $2  and nota_entrada.fecha >= $3 and " +
        " nota_entrada.fecha <= $4 "
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_tienda,
                req.body.fecha_inicial,
                req.body.fecha_final,
                req.body.id_nota_registro
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results-registers-back', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar los registros'
        })
    })
})

router.post('/search/back/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, precio, modelo, nombre_imagen, " +
        " descripcion, articulos.id as id, tiendas.id as id_tienda, nota_devolucion.fecha as fecha, num_arts " +
        " from articulos, proveedores, tiendas, nota_devolucion where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and nota_devolucion.id_articulo = articulos.id and nota_devolucion.id_nota_devolucion = $5 and " +
        " articulos.id_tienda = tiendas.id and tiendas.id = $2  and nota_devolucion.fecha >= $3 and " +
        " nota_devolucion.fecha <= $4 "
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_tienda,
                req.body.fecha_inicial,
                req.body.fecha_final,
                req.body.id_nota_devolucion
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results-registers', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar los registros'
        })
    })
})

router.post('/search/edits/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, precio, modelo, nombre_imagen, " +
        " descripcion, articulos.id as id, tiendas.id as id_tienda, nota_modificacion.fecha as fecha, modificacion " +
        " from articulos, proveedores, tiendas, nota_modificacion where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and nota_modificacion.id_articulo = articulos.id and " +
        " articulos.id_tienda = tiendas.id and tiendas.id = $2  and nota_modificacion.fecha >= $3 and " +
        " nota_modificacion.fecha <= $4 "
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_tienda,
                req.body.fecha_inicial,
                req.body.fecha_final
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results-edits', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar los registros'
        })
    })
})


router.post('/search/registers/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    query = " select nota_entrada.id as unique_id_register, id_nota_registro, articulo, proveedores.nombre as nombre_prov, " +
        " n_existencias, precio, costo, modelo, nombre_imagen, " +
        " descripcion, articulos.id as id, tiendas.id as id_tienda, nota_entrada.fecha as fecha, num_arts " +
        " from articulos, proveedores, tiendas, nota_entrada where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and nota_entrada.id_articulo = articulos.id and nota_entrada.id_nota_registro = $5 and " +
        " articulos.id_tienda = tiendas.id and tiendas.id = $2  and nota_entrada.fecha >= $3 and " +
        " nota_entrada.fecha <= $4 "
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_tienda,
                req.body.fecha_inicial,
                req.body.fecha_final,
                req.body.id_nota_registro
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales'),
            //t.oneOrNone('select nombre, a_cuenta from proveedores where proveedores.id = $1', [req.body.id_proveedor])
            // Este a cuenta ya fue considerado
            t.oneOrNone('select nombre, sum(transacciones_a_cuenta.monto) as a_cuenta from transacciones_a_cuenta, proveedores ' +
                ' where proveedores.id = transacciones_a_cuenta.id_proveedor and proveedores.id = $1 group by nombre',
                [req.body.id_proveedor])
        ])
    }).then(function (data) {
        console.log(data)
        res.render('partials/items/search-items-results-registers', {
            items: data[0],
            user: data[1],
            terminales: data[2],
            por_pagar: data[3]
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar los registros'
        })
    })
})

router.post('/search/items/results_sols', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.manyOrNone(" select articulo, proveedores.nombre as nombre_proveedor, unidades_sin_regresar, " +
        " modelo, id_registro_entrada, descripcion,  n_solicitudes, costo_unitario, tiendas.nombre as nombre_tienda " +
        " from articulos_solicitados, articulos, proveedores, tiendas where articulos_solicitados.id_articulo = " +
        " articulos.id and articulos.id_proveedor = proveedores.id and articulos.id_tienda = tiendas.id and " +
        " articulos_solicitados.id_registro_entrada = $1 and unidades_sin_regresar > 0", [
        req.body.id_papel
    ]).then(function (data) {
        console.log(data)
        res.render('partials/items/search-items-results-sols', {
            items: data
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
})

router.post('/search/items/results_ninv', isAuthenticated, function (req, res) {
    console.log(req.body);
    console.log(req.user.permiso_administrador)
    //var pageSize = 10;
    //var offset = req.body.page * pageSize;
    var query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, articulos.precio," +
        " modelo, nombre_imagen, estatus, venta_articulos.precio as precio_venta, " +
        " descripcion, articulos.id as id " +
        " from articulos, proveedores, tiendas, usuarios, venta_articulos where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and usuarios.id_tienda = articulos.id_tienda and " +
        " articulos.id_tienda = tiendas.id and " +
        " tiendas.id = $6 and venta_articulos.id_articulo = articulos.id and " +
        " venta_articulos.estatus ilike '%$5#%' and usuarios.id =  " + req.user.id

    if (req.user.permiso_administrador) {
        query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, articulos.precio as precio, " +
            " modelo, nombre_imagen, estatus, venta_articulos.precio as precio_venta, " +
            " descripcion, articulos.id as id, tiendas.id as id_tienda " +
            " from articulos, proveedores, tiendas, venta_articulos " +
            " where id_proveedor = $1 and articulos.id_proveedor = proveedores.id and " +
            " venta_articulos.id_articulo = articulos.id and venta_articulos.estatus ilike '%$5#%' and " +
            " articulos.id_tienda = tiendas.id and tiendas.id = $6 "
    }
    console.log(query);
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_marca,
                req.body.articulo,
                req.body.modelo,
                req.body.estatus,
                req.body.id_tienda
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results-ninv', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


router.post('/search/items/results_inv', isAuthenticated, function (req, res) {
    console.log(req.body);
    console.log(req.user.permiso_administrador)
    //var pageSize = 10;
    //var offset = req.body.page * pageSize;
    var query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, precio, modelo, nombre_imagen, " +
        " descripcion, articulos.id as id " +
        " from articulos, proveedores, tiendas, usuarios where id_proveedor = $1 and " +
        " articulos.id_proveedor = proveedores.id and usuarios.id_tienda = articulos.id_tienda and " +
        // " articulo ilike '%$3#%' and modelo ilike '%$4#%' and  articulos.id_tienda = tiendas.id and " +
        " modelo ilike '%$4#%' and  articulos.id_tienda = tiendas.id and " +
        " tiendas.id = $5 and usuarios.id =  " + req.user.id

    if (req.user.permiso_administrador) {
        query = "select articulo, proveedores.nombre as nombre_prov, n_existencias, precio, modelo, nombre_imagen, " +
            " descripcion, articulos.id as id, tiendas.id as id_tienda " +
            " from articulos, proveedores, tiendas where id_proveedor = $1 and articulos.id_proveedor = proveedores.id and " +
            " articulos.id_tienda = tiendas.id and tiendas.id = $5 and modelo ilike '%$4#%' "
        // " articulo ilike '%$3#%' and articulos.id_tienda = tiendas.id and tiendas.id = $5 and modelo ilike '%$4#%' "
    }
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(query, [
                req.body.id_proveedor,
                req.body.id_marca,
                req.body.articulo,
                req.body.modelo,
                req.body.id_tienda
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results-inv', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});


router.post('/register/sol', isAuthenticated, function (req, res) {
    console.log('register solicitados....poner fecha de registro de solicitados ');
    console.log(req.body);
    db_conf.db.task(function (t) {
        return this.batch([
            t.oneOrNone(" update venta_articulos set estatus = 'pendiente_pago' where id = $1 " +
                " returning id_articulo, unidades_vendidas", [
                req.body.id_venta_articulo
            ]),
            t.oneOrNone(" select * from articulos where id = $1", [
                req.body.item_id
            ]),
            t.oneOrNone(" update articulos_solicitados set costo_unitario = $1, n_solicitudes = $2, estatus = 'ingresada',  " +
                " id_registro_entrada = $6, unidades_sin_regresar = $2 " +
                " where id_venta = $3 and id_articulo = $4 and id_articulo_unidad = $5 returning id", [
                req.body.costo_proveedor,
                req.body.existencias,
                //req.body.id_venta_articulo,
                req.body.venta_id_tot,
                req.body.item_id,
                req.body.id_articulo_unidad,
                req.body.id_papel
            ])
        ]).then(function (data) {
            db_conf.db.task(function (t) {
                var the_query = [];
                // In case there are more registers than the selled (solicited) clothes
                if (req.body.existencias > 1) {
                    the_query.push(
                        t.oneOrNone(" update articulos set n_existencias = n_existencias + $2 where id = $1 returning id ", [
                            req.body.item_id,
                            numericCol(req.body.existencias - 1)
                        ])
                    )
                }
                the_query.push(
                    t.oneOrNone(' update proveedores set  ' +
                        ' por_pagar = por_pagar - $2 where id = $1 returning id', [
                        numericCol(data[1].id_proveedor),
                        numericCol(req.body.costo_proveedor * req.body.existencias)
                    ])
                )
                the_query.push(
                    t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                        ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                        numericCol(data[1].id_proveedor),
                        'cargo',
                        'registro de prendas solicitadas',
                        -numericCol(req.body.costo_proveedor * req.body.existencias)
                    ])
                )
                the_query.push(
                    t.oneOrNone(' insert into nota_entrada (id_nota_registro, id_articulo, ' +
                        ' id_usuario, num_arts, hora, fecha, costo_unitario, concepto) values ($1, $2, $3, ' +
                        ' $4, now(), current_date, $5, $6)' +
                        ' returning id_articulo', [
                        req.body.id_papel,
                        data[0].id_articulo,
                        req.user.id,
                        req.body.existencias,
                        numericCol(req.body.costo_proveedor),
                        'ingreso articulos solicitados'
                    ])
                )
                return this.batch(the_query)
            })
        }).then(function (data) {
            res.json({
                estatus: 'Ok',
                message: 'El artículo solicitado ha sido dado de alta exitosamente'
            })
        }).catch(function (error) {
            console.log(error)
            res.json({
                estatus: 'Error',
                message: 'Ocurrió un error al registrar el artículo'
            })
        })
    })
})

router.post('/search/items/sol', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone(" select articulo, proveedores.nombre as nombre_prov, tiendas.nombre as " +
                " nombre_tienda, n_existencias, articulos.precio, modelo, nombre_imagen, unidades_vendidas, " +
                " descripcion, articulos.id as id, venta_articulos.id as id_venta_articulo, articulos.costo, " +
                " id_articulo_unidad, ventas.id as venta_id_tot from articulos, proveedores, tiendas, venta_articulos, ventas " +
                " where articulos.id_proveedor = proveedores.id and ventas.id_tienda = tiendas.id " +
                " and ventas.id_tienda = tiendas.id and venta_articulos.id_articulo = articulos.id and " +
                " venta_articulos.estatus = 'solicitada' and venta_articulos.id_venta = ventas.id and  " +
                " ventas.id_papel = $6 and (ventas.id_tienda = $5 and id_proveedor = $1 and modelo ilike '%$4#%') ", [
                req.body.id_proveedor,
                req.body.id_marca,
                req.body.articulo,
                req.body.modelo,
                req.body.id_tienda,
                req.body.id_papel
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-sol', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});


router.post('/search/items/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    //var pageSize = 10;
    //var offset = req.body.page * pageSize;
    db_conf.db.task(function (t) {
        return this.batch([
            t.manyOrNone("select articulo, proveedores.nombre as nombre_prov, tiendas.nombre as nombre_tienda, n_existencias, precio, modelo, nombre_imagen, descripcion, articulos.id as id" +
                " from articulos, proveedores, tiendas where articulos.id_proveedor = proveedores.id and id_tienda = tiendas.id and articulos.id_tienda = tiendas.id and " +
                "(id_tienda = $5 and id_proveedor = $1 and modelo ilike '%$4#%') ", [
                req.body.id_proveedor,
                req.body.id_marca,
                req.body.articulo,
                req.body.modelo,
                req.body.id_tienda
            ]),
            t.oneOrNone('select * from usuarios where id = $1', [req.user.id]),
            t.manyOrNone('select * from terminales')
        ])
    }).then(function (data) {
        res.render('partials/items/search-items-results', {
            items: data[0],
            user: data[1],
            terminales: data[2]
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/suppliers/find-suppliers-view', isAuthenticated, function (req, res) {
    db_conf.db.manyOrNone(
        'select nombre, id from proveedores'
    ).then(function (data) {
        res.render('partials/find-suppliers', {proveedores: data});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/employees/find-employees-view', isAuthenticated, function (req, res) {
    res.render('partials/find-employees');
});

router.post('/notes/find-notes-view', function (req, res) {
    var query = "select * from ventas, tiendas where ventas.estatus = 'activa' and ventas.id_tienda = tiendas.id and tiendas.id = " +
        req.user.id_tienda
    var query2 = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda
    if (req.user.permiso_administrador) {
        query = "select * from ventas, tiendas where ventas.id_tienda = tiendas.id and ventas.estatus = 'activa'"
        query2 = 'select * from tiendas'
    }
    db_conf.db.task(function (t) {
        return t.batch([
            t.manyOrNone(query),
            t.manyOrNone(query2)
        ])
    }).then(function (data) {
        console.log(data.length);
        res.render('partials/notes/find-notes', {tiendas: data[1], notas: data[0]});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/notes/find-notes-partials-view', function (req, res) {
    var query = "select transferencia.id_papel as id_papel from transferencia, ventas, tiendas where transferencia.id_venta = ventas.id and  ventas.estatus = 'activa' and ventas.id_tienda = tiendas.id and tiendas.id = " +
        req.user.id_tienda
    var query2 = 'select * from tiendas where tiendas.id = ' + req.user.id_tienda
    if (req.user.permiso_administrador) {
        query = "select  transferencia.id_papel as id_papel from transferencia, ventas, tiendas where transferencia.id_venta = ventas.id and ventas.id_tienda = tiendas.id and  ventas.estatus = 'activa'"
        query2 = 'select * from tiendas'
    }
    db_conf.db.task(function (t) {
        return t.batch([
            t.manyOrNone(query),
            t.manyOrNone(query2)
        ])
    }).then(function (data) {
        console.log(data);
        res.render('partials/notes/find-notes', {tiendas: data[1], notas: data[0]});
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.post('/supplier/details', isAuthenticated, function (req, res) {
    console.log(req.body);
    var fecha_inicial = req.body.fecha_inicial
    db_conf.db.oneOrNone(
        ' select max(fecha) as lat_pay from nota_pago_prov ' +
        ' where id_proveedor = $1', [
            req.body.id_proveedor
        ]).then(function (data) {
        if(data.lat_pay && req.body['lat_pay']){
            fecha_inicial = new Date(data.lat_pay).toLocaleDateString()
        }
        console.log('fecha_inicial: ' + fecha_inicial)
        return db_conf.db.task(function (t) {
            return t.batch([
                t.oneOrNone(" select * from proveedores where id = $1 ", [
                    req.body.id_proveedor
                ]),
                // Monto de Ventas Periodo
                t.manyOrNone(
                    " select tiendas.nombre as nombre_tienda, sum(unidades_vendidas) " +
                    " as unidades_vendidas, id_articulo, articulo, descripcion, ventas.id_papel, " +
                    " venta_articulos.estatus, " +
                    " articulos.costo as costo, articulos.modelo as modelo, fecha_venta from tiendas, " +
                    " venta_articulos, articulos, ventas, (select min(fecha) as fecha_venta, " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where " +
                    " transferencia.id_venta = ventas.id group by id_venta) as fechas_ventas " +
                    " where venta_articulos.estatus " +
                    " != 'solicitada' and ventas.estatus = 'activa' and ventas.id = " +
                    " venta_articulos.id_venta and fechas_ventas.fecha_venta <= $2 and " +
                    " fue_sol = 0 and " +
                    " fechas_ventas.fecha_venta >= $1 and fechas_ventas.id_venta = ventas.id " +
                    " and venta_articulos.id_articulo = articulos.id " +
                    " and id_proveedor = $3 and tiendas.id = ventas.id_tienda group by id_articulo, " +
                    " id_papel, costo, modelo, articulo, descripcion, fecha_venta, " +
                    " nombre_tienda, venta_articulos.estatus", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                // Monto Por Pagar de Ventas
                t.oneOrNone(
                    " select sum(tot_costos) as tot_costos from (select sum(costo * unidades_vendidas) " +
                    " as tot_costos from venta_articulos, articulos, ventas, (select min(fecha) as fecha_venta, " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where transferencia.id_venta " +
                    " = ventas.id group by id_venta) as fechas_ventas where venta_articulos.estatus != 'devolucion' " +
                    " and venta_articulos.estatus != 'solicitada' and ventas.estatus = 'activa' and ventas.id = " +
                    " venta_articulos.id_venta and fechas_ventas.fecha_venta <= $2 and " +
                    " fue_sol = 0 and " +
                    " venta_articulos.id_articulo = articulos.id and " +
                    " fechas_ventas.fecha_venta >= $1 and fechas_ventas.id_venta = ventas.id " +
                    " and id_proveedor = $3 group by id_articulo, venta_articulos.id_venta, costo, modelo, " +
                    " articulo, descripcion, fecha_venta) as costos", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                // Total Artículos Solicitados
                t.manyOrNone(
                    " select tiendas.nombre as nombre_tienda,  " +
                    " id_articulo, articulo, descripcion, id_nota_registro, " +
                    " costo_unitario, articulos.modelo as modelo, fecha, concepto, num_arts from tiendas, " +
                    " articulos, nota_entrada, proveedores where nota_entrada.concepto = " +
                    " 'ingreso articulos solicitados' and proveedores.id = $3 and " +
                    " articulos.id = nota_entrada.id_articulo and articulos.id_proveedor = proveedores.id and " +
                    " tiendas.id = articulos.id_tienda  and " +
                    " nota_entrada.fecha >= $1 and nota_entrada.fecha <= $2", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]
                ),
                // Monto Por Pagar Articulos Solicitados
                t.oneOrNone(
                    " select sum(costo_tot) as costo_tot from (" +
                    " select sum(costo_unitario * num_arts) as costo_tot  " +
                    " from tiendas, " +
                    " articulos, nota_entrada, proveedores where nota_entrada.concepto = " +
                    " 'ingreso articulos solicitados' and proveedores.id = $3 and " +
                    " articulos.id = nota_entrada.id_articulo and articulos.id_proveedor = proveedores.id and " +
                    " tiendas.id = articulos.id_tienda  and " +
                    " nota_entrada.fecha >= $1 and nota_entrada.fecha <= $2) as costos", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                // Total Artículos Devueltos
                t.manyOrNone(" select nombre_tienda, unidades_vendidas, id_articulo, id_articulo_unidad, articulo, " +
                    " descripcion, id_papel, modelo, fecha_venta, fue_sol, max(costo_def) " +
                    " as costo from ( select tiendas.nombre as nombre_tienda, " +
                    " unidades_vendidas, venta_articulos.id_articulo, id_articulo_unidad, articulo, descripcion, " +
                    " ventas.id_papel, articulos.modelo as modelo, fecha_venta, fue_sol, " +
                    " case when fue_sol > 0 then nota_entrada.costo_unitario else articulos.costo " +
                    " end as costo_def from nota_entrada, tiendas, venta_articulos, articulos, " +
                    " ventas, (select fecha as fecha_venta, transferencia.id_venta as " +
                    " id_venta from ventas, transferencia where transferencia.id_venta = ventas.id " +
                    " ) as fechas_ventas where nota_entrada.id_articulo = " +
                    " venta_articulos.id_articulo and venta_articulos.estatus = 'devolucion'  " +
                    " and ventas.estatus = 'activa' and ventas.id = venta_articulos.id_venta and " +
                    " fechas_ventas.fecha_venta <= $2 and  venta_articulos.id_articulo = " +
                    " articulos.id and  fechas_ventas.fecha_venta >= $1 and " +
                    " fechas_ventas.id_venta = ventas.id and id_proveedor = $3 and tiendas.id = " +
                    " ventas.id_tienda) as temp group by nombre_tienda, unidades_vendidas, " +
                    " id_articulo, articulo, descripcion, id_papel, modelo, fecha_venta, fue_sol, id_articulo_unidad", [
                    fecha_inicial,
                    req.body.fecha_final,
                    req.body.id_proveedor
                ]),
                // Monto Por Recibir Articulos Devueltos
                t.oneOrNone(" select sum(costo_def * unidades_vendidas) as tot_costos from (select max(costo_def)  " +
                    " as costo_def, id_articulo, id_articulo_unidad, id_venta, id_articulo, unidades_vendidas " +
                    " from (select case when fue_sol > 0 then costo_unitario else costo end as costo_def,  " +
                    " unidades_vendidas, venta_articulos.id_venta, venta_articulos.id_articulo, id_articulo_unidad from  " +
                    " venta_articulos, nota_entrada, articulos, ventas, (select fecha as fecha_venta,  " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where  transferencia.id_venta = " +
                    " ventas.id) as fechas_ventas where  venta_articulos.estatus = 'devolucion' and " +
                    " ventas.estatus = 'activa' and ventas.id =  venta_articulos.id_venta and fechas_ventas.fecha_venta <= " +
                    " $2 and  venta_articulos.id_articulo = articulos.id and fechas_ventas.fecha_venta >= $1  and " +
                    " fechas_ventas.id_venta = ventas.id and nota_entrada.id_articulo =  venta_articulos.id_articulo " +
                    " and id_proveedor = $3 group by venta_articulos.id_articulo,  id_articulo_unidad, venta_articulos.id_venta, " +
                    " modelo, articulo, descripcion, fecha_venta, fue_sol,  costo_def, venta_articulos.id_articulo, " +
                    " unidades_vendidas) as temp group by id_articulo, id_articulo_unidad, id_venta, id_articulo, unidades_vendidas) as temp1", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                // Todos los pagos efectuados en el periodo
                t.manyOrNone(
                    " select * from nota_pago_prov where fecha <= $2 and fecha >= $1 and id_proveedor = $3", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                t.oneOrNone(
                    " select sum(monto_pagado) as monto_total from nota_pago_prov where fecha <= $2 and fecha >= $1 and id_proveedor = $3", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]),
                t.manyOrNone(
                    " select articulo, modelo, unidades_regresadas, fecha, devolucion_prov_articulos.costo_unitario, " +
                    " fue_sol from devolucion_prov_articulos, articulos where fecha <= $2 and fecha >= $1 and articulos.id_proveedor = $3 " +
                    " and articulos.id = devolucion_prov_articulos.id_articulo", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]
                ),
                // Global por pagar
                t.oneOrNone(
                    " select sum(monto) as por_pagar from transacciones_por_pagar where fecha >= $1 and fecha <= $2 and id_proveedor = $3 ", [
                        fecha_inicial,
                        req.body.fecha_final,
                        req.body.id_proveedor
                    ]
                )
            ])
        })
    }).then(function (data) {
        console.log(JSON.stringify(data))
        res.render('partials/suppliers/supplier_details',
            {
                proveedor: data[0],
                ventas: data[1],
                total_ventas: data[2],
                solicitudes: data[3],
                total_sol: data[4],
                devoluciones: data[5],
                total_dev: data[6],
                total_pagos: data[7],
                total_pago: data[8],
                devs_prov: data[9],
                fecha_inicial: fecha_inicial,
                fecha_final: req.body.fecha_final,
                global_pagar: data[10]
            }
        );
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al cargar los datos del proveedor'
        })
    })
});

router.post('/employee/details', isAuthenticated, function (req, res) {
    // Comisión total 3%.
    console.log('PRINTING EMPLOYEE DETAILS');
    console.log(req.body);
    var id = req.body.id;
    var store_id = req.body.id_tienda;
    var fecha_inicial = req.body.fecha_init;
    var fecha_final = req.body.fecha_fin;
    db_conf.db.task(function (t) {
        return this.batch([
            /* 0: Usuarios */
            this.one('select * from usuarios where id = $1', id),
            /* 1: Retrasos   */
            this.manyOrNone("select * from asistencia, usuarios where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and hora > hora_llegada and tipo = 'entrada' and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 2: Salidas prematuras */
            this.manyOrNone("select * from asistencia, usuarios where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and hora < hora_salida and tipo = 'salida' and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 3: Domingos */
            this.oneOrNone("select count(*) as domingos from usuarios, asistencia where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and EXTRACT(DOW from asistencia.fecha::DATE) = 0 and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 4: Préstamos */
            this.manyOrNone("select * from prestamos where id_usuario = $1 and fecha_liquidacion >= $2 and fecha_prestamo <= $3", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 5: Pago semanal de préstamo*/
            this.one(
                " select  sum(pago_semanal * (( least(to_date($3, 'YYYY-MM-DD'), fecha_liquidacion) - " +
                " greatest(to_date($2, 'YYYY-MM-DD'), fecha_prestamo))/7)::int  ) as pago from prestamos where " +
                " fecha_liquidacion >= $2 and fecha_prestamo <= $3 and id_usuario = $1", [
                    id,
                    fecha_inicial,
                    fecha_final
                ]),
            /* 6: Ventas Individuales en la semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion'", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 7: Monto de ventas individuales en la semana */
            this.oneOrNone(" select sum(monto) as montoVentas from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 8: mismo que el anterior!!! no se usa!!! */
            this.oneOrNone(" select sum(monto) from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 9: Tienda */
            this.oneOrNone(" select * from usuarios, tiendas where usuarios.id = $1 and " +
                " tiendas.id = usuarios.id_tienda ", id),
            /* 10: Ventas Tienda en la semana */
            this.manyOrNone(" select * from ventas, transferencia where ventas.id_tienda = $1 and  " +
                " transferencia.fecha <= $3 and transferencia.fecha >=  $2 "  +
                " and transferencia.id_venta = ventas.id and transferencia.motivo_transferencia != 'devolucion' " +
                " and transferencia.motivo_transferencia != 'cancelacion'", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 11: Monto ventas tienda */
            this.oneOrNone(" select sum(monto) as montotienda from (select monto_efectivo + monto_credito +  monto_debito as monto from ventas, " +
                "  transferencia where ventas.id_tienda = $1 and  transferencia.fecha <= $3 and transferencia.fecha >= $2 " +
                " and transferencia.id_venta = ventas.id  and transferencia.motivo_transferencia != 'devolucion' and " +
                " transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 12: Pagos extras */
            this.oneOrNone(" select * from pagos_extra, usuarios where pagos_extra.id_usuario = usuarios.id " +
                " and usuarios.id = $1 and " +
                " pagos_extra.fecha_pago_extra <= $3 and " +
                " pagos_extra.fecha_pago_extra >= $2", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 13: Ventas Individuales entre semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 " +
                " and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and " +
                " transferencia.motivo_transferencia != 'cancelacion' and extract(dow from transferencia.fecha) in " +
                " (1, 2, 3, 4, 5) ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 14: Monto ventas individuales entre semana */
            this.oneOrNone(" select sum(monto) as montoVentas from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and " +
                " transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and extract(dow from transferencia.fecha) in (1, 2, 3, 4, 5) " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 15: Ventas por tienda entre semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_tienda = $1 and " +
                " transferencia.fecha <= $3 " +
                " and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and  " +
                " transferencia.motivo_transferencia != 'cancelacion' and extract(dow from transferencia.fecha) in " +
                " (1, 2, 3, 4, 5) ", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 16: Monto ventas por tienda entre semana */
            this.oneOrNone(" select sum(monto) as montotienda from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_tienda = $1 and " +
                " transferencia.fecha <= $3 and " +
                " transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and extract(dow from transferencia.fecha) in (1, 2, 3, 4, 5) " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                store_id,
                fecha_inicial,
                fecha_final
            ])
        ]).then(function (data) {
            return t.batch([
                data,
                /* Penalizaciones: la penalización más grave aplicable es la que se asigna */
                t.manyOrNone("select * from penalizaciones where (dias_retraso > 0 and dias_retraso <= $1) order by monto desc limit 1", [
                    data[1].length,
                    data[2].length,
                    7 - data[3].length
                ]),
                /* Se listan todos los bonos */
                t.manyOrNone("select * from bonos, usuarios  where ((monto_alcanzar <= $1 and criterio = 'Tienda' and bonos.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3)) and usuarios.empleado = false order by monto desc", [
                    data[11].montotienda,
                    data[7].montoventas,
                    req.body.id
                ]),
                /* Monto bonos total */
                t.oneOrNone("select sum(monto) as monto from bonos, usuarios  where ((monto_alcanzar <= $1 and criterio = 'Tienda' and bonos.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3)) and usuarios.empleado = false ", [
                    data[11].montotienda,
                    data[7].montoventas,
                    req.body.id
                ]),
                /* Se listan todos los premios */
                t.manyOrNone("select * from premios, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and premios.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3) order by monto desc", [
                    data[16].montotienda,
                    data[14].montoventas,
                    req.body.id
                ]),
                /* Monto premios total*/
                t.oneOrNone("select sum(monto) as monto from premios, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and premios.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3)", [
                    data[16].montotienda,
                    data[14].montoventas,
                    req.body.id
                ]),
            ])
        });
    }).then(function (data) {
        console.log(data)
        var totalComision = (data[0][8].sum === null ? 0 : data[0][8].sum);

        console.log('total comision ' + totalComision * data[0][0].comision);
        var pagoExtra = (data[0][12] === null ? {'monto': 0, 'descripcion': ''} : data[0][12]);
        var montoPrestamos = (data[0][5] === null ? {'pago': 0} : data[0][5]);
        var montoVentas = (data[0][7] === null ? {'montoventas': 0} : data[0][7]);
        var montoVentasTiendas = (data[0][11] === null ? {'montotienda': 0} : data[0][11]);
        var bono = (data[2].length > 0 ? data[2] : []);
        var penalizacion = (data[1].length > 0 ? data[1] : []);
        var prestamos = (data[0][4].length > 0 ? data[0][4] : []);
        var entradasTarde = (data[0][1].length > 0 ? data[0][1] : []);
        var salidasTemprano = (data[0][2].length > 0 ? data[0][2] : []);
        var ventas = (data[0][6].length > 0 ? data[0][6] : []);
        var tienda = (data[0][9].length > 0 ? data[0][9] : []);
        var ventaTiendas = (data[0][10].length > 0 ? data[0][10] : []);
        var montoPremios = (data[5] === null ? {'monto': 0} : data[5]);

        res.render('partials/employee-detail', {
            usuario: data[0][0],
            entradasTarde: entradasTarde,
            salidasTemprano: salidasTemprano,
            domingos: data[0][3],
            prestamos: prestamos,
            montoPrestamos: data[0][5],
            ventas: ventas,
            montoVentas: data[0][7],//montoVentas,
            totalComision: {'comision': totalComision * data[0][0].comision},//totalComsion,
            tienda: data[0][9],
            ventaTiendas: ventaTiendas,
            montoVentasTiendas: data[0][11],//montoVentasTiendas,
            penalizacion: penalizacion,
            bono: bono,
            pagos_extra: pagoExtra,
            montoBono: data[3],
            premios: data[4],
            montoPremios: montoPremios,
            fecha_inicial: req.body.fecha_init,
            fecha_final: req.body.fecha_fin
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });
});

router.get('/print/supplier/details', (req, res) => {


    let {id_proveedor, fecha_inicial, fecha_final} = req.query;


    //var fecha_inicial = req.body.fecha_inicial
    db_conf.db.oneOrNone(
        ' select max(fecha) as lat_pay from nota_pago_prov ' +
        ' where id_proveedor = $1', [
            id_proveedor
        ]).then(function (data) {
        // var fecha_inicial = req.body.fecha_inicial
        if(data.lat_pay && req.body['lat_pay']){
            fecha_inicial = new Date(data.lat_pay).toLocaleDateString()
        }
        return db_conf.db.task(function (t) {
            return t.batch([
                t.oneOrNone(" select * from proveedores where id = $1 ", [
                    id_proveedor
                ]),
                // Monto de Ventas Periodo
                t.manyOrNone(
                    " select tiendas.nombre as nombre_tienda, sum(unidades_vendidas) " +
                    " as unidades_vendidas, id_articulo, articulo, descripcion, ventas.id_papel, " +
                    " venta_articulos.estatus, " +
                    " articulos.costo as costo, articulos.modelo as modelo, fecha_venta from tiendas, " +
                    " venta_articulos, articulos, ventas, (select min(fecha) as fecha_venta, " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where " +
                    " transferencia.id_venta = ventas.id group by id_venta) as fechas_ventas " +
                    " where venta_articulos.estatus " +
                    " != 'solicitada' and ventas.estatus = 'activa' and ventas.id = " +
                    " venta_articulos.id_venta and fechas_ventas.fecha_venta <= $2 and " +
                    " fue_sol = 0 and " +
                    " fechas_ventas.fecha_venta >= $1 and fechas_ventas.id_venta = ventas.id " +
                    " and venta_articulos.id_articulo = articulos.id " +
                    " and id_proveedor = $3 and tiendas.id = ventas.id_tienda group by id_articulo, " +
                    " id_papel, costo, modelo, articulo, descripcion, fecha_venta, " +
                    " nombre_tienda, venta_articulos.estatus", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                // Monto Por Pagar de Ventas
                t.oneOrNone(
                    " select sum(tot_costos) as tot_costos from (select sum(costo * unidades_vendidas) " +
                    " as tot_costos from venta_articulos, articulos, ventas, (select min(fecha) as fecha_venta, " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where transferencia.id_venta " +
                    " = ventas.id group by id_venta) as fechas_ventas where venta_articulos.estatus != 'devolucion' " +
                    " and venta_articulos.estatus != 'solicitada' and ventas.estatus = 'activa' and ventas.id = " +
                    " venta_articulos.id_venta and fechas_ventas.fecha_venta <= $2 and " +
                    " fue_sol = 0 and " +
                    " venta_articulos.id_articulo = articulos.id and " +
                    " fechas_ventas.fecha_venta >= $1 and fechas_ventas.id_venta = ventas.id " +
                    " and id_proveedor = $3 group by id_articulo, venta_articulos.id_venta, costo, modelo, " +
                    " articulo, descripcion, fecha_venta) as costos", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                // Total Artículos Solicitados
                t.manyOrNone(
                    " select tiendas.nombre as nombre_tienda,  " +
                    " id_articulo, articulo, descripcion, id_nota_registro, " +
                    " costo_unitario, articulos.modelo as modelo, fecha, concepto, num_arts from tiendas, " +
                    " articulos, nota_entrada, proveedores where nota_entrada.concepto = " +
                    " 'ingreso articulos solicitados' and proveedores.id = $3 and " +
                    " articulos.id = nota_entrada.id_articulo and articulos.id_proveedor = proveedores.id and " +
                    " tiendas.id = articulos.id_tienda  and " +
                    " nota_entrada.fecha >= $1 and nota_entrada.fecha <= $2", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]
                ),
                // Monto Por Pagar Articulos Solicitados
                t.oneOrNone(
                    " select sum(costo_tot) as costo_tot from (" +
                    " select sum(costo_unitario * num_arts) as costo_tot  " +
                    " from tiendas, " +
                    " articulos, nota_entrada, proveedores where nota_entrada.concepto = " +
                    " 'ingreso articulos solicitados' and proveedores.id = $3 and " +
                    " articulos.id = nota_entrada.id_articulo and articulos.id_proveedor = proveedores.id and " +
                    " tiendas.id = articulos.id_tienda  and " +
                    " nota_entrada.fecha >= $1 and nota_entrada.fecha <= $2) as costos", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                // Total Artículos Devueltos
                t.manyOrNone(" select nombre_tienda, unidades_vendidas, id_articulo, id_articulo_unidad, articulo, " +
                    " descripcion, id_papel, modelo, fecha_venta, fue_sol, max(costo_def) " +
                    " as costo from ( select tiendas.nombre as nombre_tienda, " +
                    " unidades_vendidas, venta_articulos.id_articulo, id_articulo_unidad, articulo, descripcion, " +
                    " ventas.id_papel, articulos.modelo as modelo, fecha_venta, fue_sol, " +
                    " case when fue_sol > 0 then nota_entrada.costo_unitario else articulos.costo " +
                    " end as costo_def from nota_entrada, tiendas, venta_articulos, articulos, " +
                    " ventas, (select min(fecha) as fecha_venta, transferencia.id_venta as " +
                    " id_venta from ventas, transferencia where transferencia.id_venta = ventas.id " +
                    " group by id_venta) as fechas_ventas where nota_entrada.id_articulo = " +
                    " venta_articulos.id_articulo and venta_articulos.estatus = 'devolucion'  " +
                    " and ventas.estatus = 'activa' and ventas.id = venta_articulos.id_venta and " +
                    " fechas_ventas.fecha_venta <= $2 and  venta_articulos.id_articulo = " +
                    " articulos.id and  fechas_ventas.fecha_venta >= $1 and " +
                    " fechas_ventas.id_venta = ventas.id and id_proveedor = $3 and tiendas.id = " +
                    " ventas.id_tienda) as temp group by nombre_tienda, unidades_vendidas, " +
                    " id_articulo, articulo, descripcion, id_papel, modelo, fecha_venta, fue_sol, id_articulo_unidad", [
                    fecha_inicial,
                    fecha_final,
                    id_proveedor
                ]),
                // Monto Por Recibir Articulos Devueltos
                t.oneOrNone(" select sum(costo_def * unidades_vendidas) as tot_costos from (select max(costo_def)  " +
                    " as costo_def, id_articulo, id_articulo_unidad, id_venta, id_articulo, unidades_vendidas " +
                    " from (select case when fue_sol > 0 then costo_unitario else costo end as costo_def,  " +
                    " unidades_vendidas, venta_articulos.id_venta, venta_articulos.id_articulo, id_articulo_unidad from  " +
                    " venta_articulos, nota_entrada, articulos, ventas, (select min(fecha) as fecha_venta,  " +
                    " transferencia.id_venta as id_venta from ventas, transferencia where  transferencia.id_venta = " +
                    " ventas.id group by id_venta) as fechas_ventas where  venta_articulos.estatus = 'devolucion' and " +
                    " ventas.estatus = 'activa' and ventas.id =  venta_articulos.id_venta and fechas_ventas.fecha_venta <= " +
                    " $2 and  venta_articulos.id_articulo = articulos.id and fechas_ventas.fecha_venta >= $1  and " +
                    " fechas_ventas.id_venta = ventas.id and nota_entrada.id_articulo =  venta_articulos.id_articulo " +
                    " and id_proveedor = $3 group by venta_articulos.id_articulo,  id_articulo_unidad, venta_articulos.id_venta, " +
                    " modelo, articulo, descripcion, fecha_venta, fue_sol,  costo_def, venta_articulos.id_articulo, " +
                    " unidades_vendidas) as temp group by id_articulo, id_articulo_unidad, id_venta, id_articulo, unidades_vendidas) as temp1"
                    , [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                // Todos los pagos efectuados en el periodo
                t.manyOrNone(
                    " select * from nota_pago_prov where fecha <= $2 and fecha >= $1 and id_proveedor = $3", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                t.oneOrNone(
                    " select sum(monto_pagado) as monto_total from nota_pago_prov where fecha <= $2 and fecha >= $1 and id_proveedor = $3", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]),
                t.manyOrNone(
                    " select articulo, modelo, unidades_regresadas, fecha, devolucion_prov_articulos.costo_unitario, " +
                    " fue_sol from devolucion_prov_articulos, articulos where fecha <= $2 and fecha >= $1 and articulos.id_proveedor = $3 " +
                    " and articulos.id = devolucion_prov_articulos.id_articulo", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]
                ),
                // Global por pagar
                t.oneOrNone(
                    " select sum(monto) as por_pagar from transacciones_por_pagar where fecha >= $1 and fecha <= $2 and id_proveedor = $3 ", [
                        fecha_inicial,
                        fecha_final,
                        id_proveedor
                    ]
                )
            ])
        })
    }).then(function (data) {
        console.log(JSON.stringify(data))
        res.render('partials/suppliers/supplier_details_for_pdf',
            {
                proveedor: data[0],
                ventas: data[1],
                total_ventas: data[2],
                solicitudes: data[3],
                total_sol: data[4],
                devoluciones: data[5],
                total_dev: data[6],
                total_pagos: data[7],
                total_pago: data[8],
                devs_prov: data[9],
                fecha_inicial: fecha_inicial,
                fecha_final: fecha_final,
                global_pagar: data[10]
            }
        );
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al cargar los datos del proveedor'
        })
    })
});

router.get('/print/ ', /* isAuthenticated, */ function (req, res) {

    // Comisión total 3%.
    console.log('PRINTING EMPLOYEE DETAILS');
    console.log(req.query);
    var id = req.query.user_id;
    var store_id = req.query.id_tienda;
    var fecha_inicial = req.query.fecha_init;
    var fecha_final = req.query.fecha_fin;
    db_conf.db.task(function (t) {
        return this.batch([
            /* 0: Usuarios */
            this.one('select * from usuarios where id = $1', id),
            /* 1: Retrasos   */
            this.manyOrNone("select * from asistencia, usuarios where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and hora > hora_llegada and tipo = 'entrada' and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 2: Salidas prematuras */
            this.manyOrNone("select * from asistencia, usuarios where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and hora < hora_salida and tipo = 'salida' and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 3: Domingos */
            this.oneOrNone("select count(*) as domingos from usuarios, asistencia where id_usuario = $1 " +
                "and fecha <= $3 and fecha >= $2 " +
                "and EXTRACT(DOW from asistencia.fecha::DATE) = 0 and usuarios.id = asistencia.id_usuario ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 4: Préstamos */
            this.manyOrNone("select * from prestamos where id_usuario = $1 and fecha_liquidacion >= $2 and fecha_prestamo <= $3", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 5: Pago semanal de préstamo*/
            this.one(
                " select  sum(pago_semanal * (( least(to_date($3, 'YYYY-MM-DD'), fecha_liquidacion) - " +
                " greatest(to_date($2, 'YYYY-MM-DD'), fecha_prestamo))/7)::int  ) as pago from prestamos where " +
                " fecha_liquidacion >= $2 and fecha_prestamo <= $3 and id_usuario = $1", [
                    id,
                    fecha_inicial,
                    fecha_final
                ]),
            /* 6: Ventas Individuales en la semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion'", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 7: Monto de ventas individuales en la semana */
            this.oneOrNone(" select sum(monto) as montoVentas from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 8: mismo que el anterior!!! no se usa!!! */
            this.oneOrNone(" select sum(monto) from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 9: Tienda */
            this.oneOrNone(" select * from usuarios, tiendas where usuarios.id = $1 and " +
                " tiendas.id = usuarios.id_tienda ", id),
            /* 10: Ventas Tienda en la semana */
            this.manyOrNone(" select * from ventas, transferencia where ventas.id_tienda = $1 and  " +
                " transferencia.fecha <= $3 and transferencia.fecha >=  $2 "  +
                " and transferencia.id_venta = ventas.id and transferencia.motivo_transferencia != 'devolucion' " +
                " and transferencia.motivo_transferencia != 'cancelacion'", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 11: Monto ventas tienda */
            this.oneOrNone(" select sum(monto) as montotienda from (select monto_efectivo + monto_credito +  monto_debito as monto from ventas, " +
                "  transferencia where ventas.id_tienda = $1 and  transferencia.fecha <= $3 and transferencia.fecha >= $2 " +
                " and transferencia.id_venta = ventas.id  and transferencia.motivo_transferencia != 'devolucion' and " +
                " transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 12: Pagos extras */
            this.oneOrNone(" select * from pagos_extra, usuarios where pagos_extra.id_usuario = usuarios.id " +
                " and usuarios.id = $1 and " +
                " pagos_extra.fecha_pago_extra <= $3 and " +
                " pagos_extra.fecha_pago_extra >= $2", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 13: Ventas Individuales entre semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 " +
                " and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and " +
                " transferencia.motivo_transferencia != 'cancelacion' and extract(dow from transferencia.fecha) in " +
                " (1, 2, 3, 4, 5) ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 14: Monto ventas individuales entre semana */
            this.oneOrNone(" select sum(monto) as montoVentas from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_usuario = $1 and " +
                " transferencia.fecha <= $3 and " +
                " transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and extract(dow from transferencia.fecha) in (1, 2, 3, 4, 5) " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                id,
                fecha_inicial,
                fecha_final
            ]),
            /* 15: Ventas por tienda entre semana */
            this.manyOrNone(" select * from ventas, transferencia  where ventas.id_tienda = $1 and " +
                " transferencia.fecha <= $3 " +
                " and transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and transferencia.motivo_transferencia != 'devolucion' and  " +
                " transferencia.motivo_transferencia != 'cancelacion' and extract(dow from transferencia.fecha) in " +
                " (1, 2, 3, 4, 5) ", [
                store_id,
                fecha_inicial,
                fecha_final
            ]),
            /* 16: Monto ventas por tienda entre semana */
            this.oneOrNone(" select sum(monto) as montotienda from (select monto_efectivo + monto_credito + " +
                " monto_debito as monto from ventas, " +
                " transferencia where ventas.id_tienda = $1 and " +
                " transferencia.fecha <= $3 and " +
                " transferencia.fecha >= " +
                " $2 and transferencia.id_venta = ventas.id " +
                " and extract(dow from transferencia.fecha) in (1, 2, 3, 4, 5) " +
                " and transferencia.motivo_transferencia != 'devolucion' and transferencia.motivo_transferencia != 'cancelacion') as montos ", [
                store_id,
                fecha_inicial,
                fecha_final
            ])
        ]).then(function (data) {
            return t.batch([
                data,
                /* Penalizaciones: la penalización más grave aplicable es la que se asigna */
                t.manyOrNone("select * from penalizaciones where (dias_retraso > 0 and dias_retraso <= $1) order by monto desc limit 1", [
                    data[1].length,
                    data[2].length,
                    7 - data[3].length
                ]),
                /* Se listan todos los bonos */
                t.manyOrNone("select * from bonos, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and bonos.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3) order by monto desc", [
                    data[11].montotienda,
                    data[7].montoventas,
                    id
                ]),
                /* Monto bonos total */
                t.oneOrNone("select sum(monto) as monto from bonos, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and bonos.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3)", [
                    data[11].montotienda,
                    data[7].montoventas,
                    id
                ]),
                /* Se listan todos los premios */
                t.manyOrNone("select * from premios, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and premios.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3) order by monto desc", [
                    data[16].montotienda,
                    data[14].montoventas,
                    id
                ]),
                /* Monto premios total*/
                t.oneOrNone("select sum(monto) as monto from premios, usuarios  where (monto_alcanzar <= $1 and criterio = 'Tienda' and premios.id_tienda = usuarios.id_tienda and usuarios.id = $3) or " +
                    "(monto_alcanzar <=  $2 and criterio ='Individual' and usuarios.id = $3)", [
                    data[16].montotienda,
                    data[14].montoventas,
                    id
                ])
            ])
        });
    }).then(function (data) {
        var totalComision = (data[0][8].sum === null ? 0 : data[0][8].sum);
        console.log(data)
        var pagoExtra = (data[0][12] === null ? {'monto': 0, 'descripcion': ''} : data[0][12]);
        var montoPrestamos = (data[0][5] === null ? {'pago': 0} : data[0][5]);
        var montoVentas = (data[0][7] === null ? {'montoventas': 0} : data[0][7]);
        var montoVentasTiendas = (data[0][11] === null ? {'montotienda': 0} : data[0][11]);
        var bono = (data[2].length > 0 ? data[2] : []);
        var penalizacion = (data[1].length > 0 ? data[1] : []);
        var prestamos = (data[0][4].length > 0 ? data[0][4] : []);
        var entradasTarde = (data[0][1].length > 0 ? data[0][1] : []);
        var salidasTemprano = (data[0][2].length > 0 ? data[0][2] : []);
        var ventas = (data[0][6].length > 0 ? data[0][6] : []);
        var tienda = (data[0][9].length > 0 ? data[0][9] : []);
        var ventaTiendas = (data[0][10].length > 0 ? data[0][10] : []);
        var montoPremios = (data[5] === null ? {'monto': 0} : data[5]);
        console.log("monto tienda" + data[0][11]);
        console.log("monto individual" + data[0][5]);
        console.log("Tienda " + data[0][9]);
        console.log('Bono:' + data[2])
        res.render('reports/employee-details', {
            usuario: data[0][0],
            entradasTarde: entradasTarde,
            salidasTemprano: salidasTemprano,
            domingos: data[0][3],
            prestamos: prestamos,
            montoPrestamos: data[0][5],
            ventas: ventas,
            montoVentas: data[0][7],//montoVentas,
            totalComision: {'comision': totalComision * data[0][0].comision},//totalComsion,
            tienda: data[0][9],
            ventaTiendas: ventaTiendas,
            montoVentasTiendas: data[0][11],//montoVentasTiendas,
            penalizacion: penalizacion,
            bono: bono,
            pagos_extra: pagoExtra,
            montoBono: data[3],
            premios: data[4],
            montoPremios: montoPremios
        });
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    });

});


router.post('/notes/cancel', isAuthenticated, function (req, res) {
    console.log('BODY CANCELACION')
    console.log(req.body)
    db_conf.db.task(function (t) {
        return this.batch([
            this.manyOrNone(' select id_articulo, id_articulo_unidad, estatus, id_proveedor, costo, articulos.precio, unidades_vendidas, fue_sol ' +
                ' from venta_articulos, proveedores, articulos ' +
                ' where id_venta = $1 and proveedores.id = articulos.id_proveedor and ' +
                ' articulos.id = venta_articulos.id_articulo ', [
                req.body.id
            ]),
            this.oneOrNone(" update ventas set estatus = 'cancelada' where id = $1 returning id", [
                req.body.id
            ])
        ])
    }).then(function (data) {
        data = data[0]
        var queries = []
        db_conf.db.task(function (t) {
            if (data.length === 1) {
                var i = 0
                var estatus = req.body.estatus
                var id_articulo_unidad = req.body.id_articulo_unidad
                if (id_articulo_unidad == data[i].id_articulo_unidad) {
                    queries.push(
                        t.one(" update venta_articulos set estatus = $2 where id_articulo_unidad = $1 " +
                            " and id_venta = $3 returning id ", [
                            id_articulo_unidad,
                            "cancelada",
                            req.body.id
                        ])
                    )
                    if (estatus !== 'devolucion' && estatus !== 'solicitada') {
                        if (!data[i].fue_sol) {
                            // Este a cuenta ya fue considerado
                            queries.push(
                                t.one(" update proveedores set por_pagar = por_pagar + $1, a_cuenta = a_cuenta - $1 " +
                                    " where id = $2 returning id", [
                                    data[i].costo * data[i].unidades_vendidas, // * data[i].unidades_vendidas,
                                    data[i].id_proveedor
                                ]))
                            queries.push(
                                t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                                    ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                    numericCol(data[i].id_proveedor),
                                    'abono',
                                    req.body.fecha_venta,
                                    'cancelación de nota',
                                    numericCol(data[i].costo * data[i].unidades_vendidas)
                                ])
                            )
                            queries.push(
                                t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                                    ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                    numericCol(data[i].id_proveedor),
                                    'cargo',
                                    req.body.fecha_venta,
                                    'cancelación de nota',
                                    -numericCol(data[i].costo * data[i].unidades_vendidas)
                                ])
                            )
                        }
                        queries.push(
                            t.one(" update articulos set n_existencias = n_existencias + $1 " +
                                " where id = $2 returning id ", [
                                data[i].unidades_vendidas,
                                data[i].id_articulo
                            ]))
                        queries.push(
                            t.one(" insert into transferencia (id_venta, monto_efectivo, monto_credito, monto_debito, " +
                                " fecha, hora, id_terminal, motivo_transferencia) " +
                                " values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [
                                req.body.id,
                                -(data[i].precio * (req.body.optradio == 'efe')),
                                -(data[i].precio * (req.body.optradio == 'cred')),
                                -(data[i].precio * (req.body.optradio == 'deb')),
                                req.body.fecha_venta,
                                req.body.hora_venta,
                                req.body.terminal,
                                'cancelacion'
                            ])
                        )
                    }
                }
            } else {
                for (var i = 0; i < data.length; i++) {
                    for (var j = 0; j < req.body.id_articulo.length; j++) {
                        // Get Estatus & Id
                        if (req.body.id_articulo.length > 1) {
                            var estatus = req.body.estatus[j]
                            var id_articulo_unidad = req.body.id_articulo_unidad[j]
                            // var fue_sol            = req.body.fue_sol[j]
                        } else {
                            var estatus = req.body.estatus
                            var id_articulo_unidad = req.body.id_articulo_unidad
                            // var fue_sol            = req.body.fue_sol
                        }
                        if (id_articulo_unidad == data[i].id_articulo_unidad) {
                            queries.push(
                                t.one(" update venta_articulos set estatus = $2 where id_articulo_unidad = $1 " +
                                    " and id_venta = $3 returning id ", [
                                    id_articulo_unidad,
                                    "cancelada",
                                    req.body.id
                                ])
                            )
                            if (estatus !== 'devolucion' && estatus !== 'solicitada') {
                                if (!data[i].fue_sol) {
                                    // Este a cuenta ya fue considerado

                                    queries.push(
                                        t.one(" update proveedores set por_pagar = por_pagar + $1, a_cuenta = a_cuenta - $1 " +
                                            " where id = $2 returning id", [
                                            data[i].costo * data[i].unidades_vendidas, // * data[i].unidades_vendidas,
                                            data[i].id_proveedor
                                        ]))

                                    queries.push(
                                        t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                                            ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                            numericCol(data[i].id_proveedor),
                                            'abono',
                                            req.body.fecha_venta,
                                            'cancelación de nota',
                                            numericCol(data[i].costo * data[i].unidades_vendidas)
                                        ])
                                    )

                                    queries.push(
                                        t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                                            ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                            numericCol(data[i].id_proveedor),
                                            'cargo',
                                            req.body.fecha_venta,
                                            'cancelación de nota',
                                            -numericCol(data[i].costo * data[i].unidades_vendidas)
                                        ])
                                    )

                                }
                                queries.push(
                                    t.one(" update articulos set n_existencias = n_existencias + $1 " +
                                        " where id = $2 returning id ", [
                                        data[i].unidades_vendidas,
                                        data[i].id_articulo
                                    ]))
                                queries.push(
                                    t.one(" insert into transferencia (id_venta, monto_efectivo, monto_credito, monto_debito, " +
                                        " fecha, hora, id_terminal, motivo_transferencia) " +
                                        " values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [
                                        req.body.id,
                                        -(data[i].precio * (req.body.optradio == 'efe')),
                                        -(data[i].precio * (req.body.optradio == 'cred')),
                                        -(data[i].precio * (req.body.optradio == 'deb')),
                                        req.body.fecha_venta,
                                        req.body.hora_venta,
                                        req.body.terminal,
                                        'cancelacion'
                                    ])
                                )
                            }
                        }
                    }
                }
            }
            return t.batch(queries)
        })
    }).then(function (data) {
        console.log('Se ha cancelado la nota')
        res.json({
            'status': 'Ok',
            'message': 'Se ha cancelado la nota'
        })
    }).catch(function (error) {
        console.log(error)
        res.send('<b>Error</b>')
    })
});

router.post('/notes/update', isAuthenticated, function (req, res) {
    console.log('Notes update: ')
    console.log(req.body)
    db_conf.db.manyOrNone(" select id_articulo, id_articulo_unidad, estatus, id_proveedor, " +
        " costo, precio, unidades_vendidas, fue_sol, max(costo_def) as costo_def from " +
        " (select venta_articulos.id_articulo, id_articulo_unidad, estatus, " +
        " id_proveedor,  costo, articulos.precio, unidades_vendidas, fue_sol, " +
        " case when fue_sol > 0 then costo_unitario else costo end as costo_def " +
        " from venta_articulos, proveedores, nota_entrada, articulos where " +
        " id_venta = $1 and proveedores.id = articulos.id_proveedor and  " +
        " articulos.id = venta_articulos.id_articulo and articulos.id = " +
        " nota_entrada.id_articulo) as temp group by id_articulo, " +
        " id_articulo_unidad, estatus, id_proveedor, costo, precio, " +
        " unidades_vendidas, fue_sol", [
        req.body.id
    ]).then(function (data) {
        console.log('Inside notes update')
        console.log(data)
        var queries = []
        db_conf.db.task(function (t) {
            if (req.body.anotacion !== "") {
                queries.push(t.oneOrNone(" insert into anotaciones (id_venta, texto, fecha) values ($1, $2, $3) returning id ", [
                    req.body.id,
                    req.body.anotacion,
                    req.body.fecha_venta
                ]));
            }
            console.log('LENGTH: ' + req.body.id_articulo.length)
            if (data.length === 1) {
                var i = 0
                var estatus = req.body.estatus
                var id_articulo_unidad = req.body.id_articulo_unidad
                if (id_articulo_unidad == data[i].id_articulo_unidad &
                    estatus != data[i].estatus) {
                    queries.push(
                        t.one(" update venta_articulos set estatus = $2 where id_articulo_unidad = $1 " +
                            " and id_venta = $3 returning id ", [
                            id_articulo_unidad,
                            estatus,
                            req.body.id
                        ])
                    )
                    if (estatus === 'devolucion') {
                        console.log('unidades: ' + data[i].unidades_vendidas + ' id_art: ' + data[i].id_articulo);
                        // Este a cuenta ya fue considerado
                        queries.push(
                            t.one(" update proveedores set por_pagar = por_pagar + $1, a_cuenta = a_cuenta - $1 " +
                                " where id = $2 returning id", [
                                data[i].costo_def, // * data[i].unidades_vendidas,
                                data[i].id_proveedor
                            ]))
                        queries.push(
                            t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                                ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                numericCol(data[i].id_proveedor),
                                'abono',
                                req.body.fecha_venta,
                                'devolución de prenda vendida',
                                data[i].costo_def
                            ])
                        )
                        queries.push(
                            t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                                ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                numericCol(data[i].id_proveedor),
                                'cargo',
                                req.body.fecha_venta,
                                'devolución de prenda vendida',
                                -data[i].costo_def
                            ])
                        )
                        queries.push(
                            t.one(" update articulos set n_existencias = n_existencias + $1 " +
                                " where id = $2 returning id ", [
                                data[i].unidades_vendidas,
                                data[i].id_articulo
                            ]))
                        queries.push(
                            t.one(" insert into transferencia (id_venta, monto_efectivo, monto_credito, monto_debito, " +
                                " fecha, hora, id_terminal, motivo_transferencia) " +
                                " values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [
                                req.body.id,
                                -(data[i].precio * (req.body.optradio == 'efe')),
                                -(data[i].precio * (req.body.optradio == 'cred')),
                                -(data[i].precio * (req.body.optradio == 'deb')),
                                req.body.fecha_venta,
                                req.body.hora_venta,
                                req.body.terminal,
                                'devolucion'
                            ])
                        )
                    }// Estatus 'solicitada'
                }
            } else {
                for (var i = 0; i < data.length; i++) {
                    for (var j = 0; j < req.body.id_articulo.length; j++) {
                        // Get Estatus & Id
                        if (req.body.id_articulo.length > 1) {
                            var estatus = req.body.estatus[j]
                            var id_articulo_unidad = req.body.id_articulo_unidad[j]
                        } else {
                            var estatus = req.body.estatus
                            var id_articulo_unidad = req.body.id_articulo_unidad
                        }
                        console.log('ID ARTICULO UNIDAD: ' + id_articulo_unidad + 'DATA ID ARTICULO UNIDAD: ' + data[i].id_articulo_unidad)
                        if (id_articulo_unidad == data[i].id_articulo_unidad &
                            estatus != data[i].estatus) {
                            queries.push(
                                t.one(" update venta_articulos set estatus = $2 where id_articulo_unidad = $1 " +
                                    " and id_venta = $3 returning id ", [
                                    id_articulo_unidad,
                                    estatus,
                                    req.body.id
                                ])
                            )
                            if (estatus === 'devolucion') {
                                console.log('unidades: ' + data[i].unidades_vendidas + ' id_art: ' + data[i].id_articulo);
                                queries.push(
                                    t.one(" update proveedores set por_pagar = por_pagar + $1, a_cuenta = a_cuenta - $1 " +
                                        " where id = $2 returning id", [
                                        data[i].costo_def, // * data[i].unidades_vendidas,
                                        data[i].id_proveedor
                                    ]))
                                queries.push(
                                    t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                                        ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                        numericCol(data[i].id_proveedor),
                                        'abono',
                                        req.body.fecha_venta,
                                        'devolución de prenda vendida',
                                        data[i].costo_def
                                    ])
                                )
                                queries.push(
                                    t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                                        ' fecha, concepto, monto) values($1, $2, $3, $4, $5) returning id', [
                                        numericCol(data[i].id_proveedor),
                                        'cargo',
                                        req.body.fecha_venta,
                                        'devolución de prenda vendida',
                                        -data[i].costo_def
                                    ])
                                )

                                queries.push(
                                    t.one(" update articulos set n_existencias = n_existencias + $1 " +
                                        " where id = $2 returning id ", [
                                        data[i].unidades_vendidas,
                                        data[i].id_articulo
                                    ]))
                                queries.push(
                                    t.one(" insert into transferencia (id_venta, monto_efectivo, monto_credito, monto_debito, " +
                                        " fecha, hora, id_terminal, motivo_transferencia) " +
                                        " values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [
                                        req.body.id,
                                        -(data[i].precio * (req.body.optradio == 'efe')),
                                        -(data[i].precio * (req.body.optradio == 'cred')),
                                        -(data[i].precio * (req.body.optradio == 'deb')),
                                        req.body.fecha_venta,
                                        req.body.hora_venta,
                                        req.body.terminal,
                                        'devolucion'
                                    ])
                                )
                            }// Estatus 'solicitada'
                        }
                    }
                }
            }
            return t.batch(queries)
        })
    }).then(function (data) {
        console.log('Se han actualizado los estatus')
        res.json({
            'status': 'Ok',
            'message': 'Se han actualizado los estatus correctamente'
        })
    }).catch(function (error) {
        console.log(error)
        res.send('<b>Error</b>')
    })
})

router.post('/notes/abono', isAuthenticated, function (req, res) {
    console.log(req.body);
    var the_query = []
    db_conf.db.task(function (t) {
        the_query.push(
            this.manyOrNone('select * from venta_articulos where id_venta = $1', [
                req.body.id
            ]));
        the_query.push(
            this.manyOrNone(" insert into transferencia (id_venta, monto_efectivo, monto_credito, " +
                " monto_debito, id_terminal, fecha, hora, id_papel, motivo_transferencia) " +
                " values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id", [
                req.body.id,
                req.body.optradio === 'efe' ? req.body.monto_abonar : 0,
                req.body.optradio === 'cred' ? req.body.monto_abonar : 0,
                req.body.optradio === 'deb' ? req.body.monto_abonar : 0,
                req.body.terminal,
                req.body.fecha_venta,
                req.body.hora_venta,
                req.body.id_papel,
                'abono'
            ]));
        if (req.body.anotacion !== "") {
            the_query.push(
                this.oneOrNone(" insert into anotaciones (id_venta, texto, fecha) values ($1, $2, $3) returning id ", [
                    req.body.id,
                    req.body.anotacion,
                    req.body.fecha_venta
                ])
            )
        }
        return t.batch(the_query)
    }).then(function (data) {
        console.log('Se ha abonado la nota');
        res.json({
            status: 'Ok',
            message: 'Se ha registrado el abono.'
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
});

router.post('/notes/payment', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.task(function (t) {
        return t.batch([
            db_conf.db.manyOrNone(" select id_papel, ventas.id as id_venta, tiendas.nombre as nombre_tienda, usuarios.nombres as nombre_usuario, " +
                " fechas.fecha_venta, precio_venta, acum_tot_transfer_pos.sum as monto_pagado, " +
                " (precio_venta - acum_tot_transfer_pos.sum) " +
                " as saldo_pendiente, modelo, proveedores.nombre as nombre_proveedor, id_articulo_unidad, " +
                " articulo, venta_articulos.id_articulo as id_articulo, unidades_vendidas, venta_articulos.estatus , " +
                " venta_articulos.precio as precio_articulo " +
                " from (select id_venta, min(fecha) as fecha_venta from transferencia group by id_venta) as fechas, " +
                " (select id_venta, sum(monto_pagado) from (select id_venta, (monto_credito + monto_debito + " +
                " monto_efectivo) as monto_pagado from transferencia where monto_credito >= 0 " +
                " and monto_debito >= 0 and monto_efectivo >= 0) " +
                " as acum_transfer group by id_venta) as acum_tot_transfer_pos, " +
                " ventas, venta_articulos, tiendas, articulos, usuarios, proveedores where " +
                " ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and " +
                " venta_articulos.id_articulo = articulos.id and fechas.id_venta = ventas.id and " +
                " proveedores.id = articulos.id_proveedor and acum_tot_transfer_pos.id_venta = " +
                " ventas.id and tiendas.id = " +
                " articulos.id_tienda and ventas.id = $1", [
                req.body.id_sale
            ]),
            db_conf.db.manyOrNone('select venta_articulos.id as id_item_sale from ventas, venta_articulos, tiendas, articulos, usuarios where ' +
                ' ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and venta_articulos.id_articulo = articulos.id ' +
                ' and tiendas.id = articulos.id_tienda and ventas.id = $1', [
                req.body.id_sale
            ]),
            db_conf.db.oneOrNone(" select sum(precio) as saldo_devuelto from venta_articulos where estatus = 'devolucion' " +
                " and  id_venta = $1 ", [req.body.id_sale]),
            db_conf.db.manyOrNone(" select * from terminales"),
            db_conf.db.manyOrNone(" select * from anotaciones where id_venta = $1", [
                req.body.id_sale
            ])
        ])
    }).then(function (data) {
        console.log(data);
        res.render('partials/notes/note-payment', {
            sales: data[0],
            items_ids: data[1],
            saldo_devuelto: data[2],
            terminales: data[3],
            comentarios: data[4]
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
});

router.post('/notes/details', isAuthenticated, function (req, res) {
    console.log('HOLA')
    console.log(req.body)
    db_conf.db.task(function (t) {
        return t.batch([
            t.manyOrNone(" select id_papel, ventas.id as id_venta, tiendas.nombre as nombre_tienda, usuarios.nombres as nombre_usuario, " +
                " fechas.fecha_venta, precio_venta, acum_tot_transfer_pos.sum as monto_pagado, " +
                " (precio_venta - acum_tot_transfer_pos.sum) " +
                " as saldo_pendiente, modelo, proveedores.nombre as nombre_proveedor, id_articulo_unidad, " +
                " articulo, venta_articulos.id_articulo as id_articulo, unidades_vendidas, venta_articulos.estatus , " +
                " venta_articulos.precio as precio_articulo " +
                " from (select id_venta, min(fecha) as fecha_venta from transferencia group by id_venta) as fechas, " +
                " (select id_venta, sum(monto_pagado) from (select id_venta, (monto_credito + monto_debito + " +
                " monto_efectivo) as monto_pagado from transferencia where monto_credito >= 0 " +
                " and monto_debito >= 0 and monto_efectivo >= 0) " +
                " as acum_transfer group by id_venta) as acum_tot_transfer_pos, " +
                " ventas, venta_articulos, tiendas, articulos, usuarios, proveedores where " +
                " ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and " +
                " venta_articulos.id_articulo = articulos.id and fechas.id_venta = ventas.id and " +
                " proveedores.id = articulos.id_proveedor and acum_tot_transfer_pos.id_venta = " +
                " ventas.id and tiendas.id = " +
                " articulos.id_tienda and ventas.id = $1", [
                req.body.id
            ]),
            t.manyOrNone('select venta_articulos.id as id_item_sale from ventas, venta_articulos, tiendas, articulos, usuarios where ' +
                ' ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and venta_articulos.id_articulo = articulos.id ' +
                ' and tiendas.id = articulos.id_tienda and ventas.id = $1', [
                req.body.id
            ]),
            t.oneOrNone(" select sum(precio) as saldo_devuelto from venta_articulos where estatus = 'devolucion' " +
                " and  id_venta = $1 ", [req.body.id]),
            t.manyOrNone(" select * from terminales"),
            t.manyOrNone('select * from transferencia where id_venta = $1', [
                req.body.id
            ]),
            t.manyOrNone(" select * from anotaciones where id_venta = $1", [
                req.body.id
            ])
        ])
    }).then(function (data) {
        console.log(data[0])
        res.render('partials/notes/notes-details', {
            sales: data[0],
            items_ids: data[1],
            saldo_devuelto: data[2],
            terminales: data[3],
            trans_sale: data[4],
            comentarios: data[5]
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
})

router.post('/notes/dev', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.task(function (t) {
        return t.batch([
            db_conf.db.manyOrNone('select * from ventas, venta_articulos, tiendas, articulos, usuarios where ' +
                'ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and venta_articulos.id_articulo = articulos.id ' +
                ' and tiendas.id = articulos.id_tienda and ventas.id = $1', [
                req.body.id_sale
            ]),
            db_conf.db.manyOrNone('select venta_articulos.id as id_item_sale from ventas, venta_articulos, tiendas, articulos, usuarios where ' +
                'ventas.id = venta_articulos.id_venta and ventas.id_usuario = usuarios.id and venta_articulos.id_articulo = articulos.id ' +
                ' and tiendas.id = articulos.id_tienda and ventas.id = $1 ', [
                req.body.id_sale
            ])
        ])
    }).then(function (data) {
        console.log(data);
        res.render('partials/notes/notes-dev', {
            sales: data[0],
            items_ids: data[1]
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
});

// Revisar este bloque
router.post('/notes/finitdev', isAuthenticated, function (req, res) {
    console.log(req.body);
    // Si hay muchos asumimos que se quiere devolver sólo uno.
    db_conf.db.tx(function (t) {
        return this.one("update venta_articulos set estatus = 'devolucion' where id = $1 returning id_articulo, unidades_vendidas, id_venta, monto_por_pagar, monto_pagado", [
            req.body.item_id
        ]).then(function (data) {

            return t.batch([
                data,
                t.one('select proveedores.id as id_prov, articulos.id as item_id, articulos.precio as precio_item, articulos.costo as costo_item ' +
                    'from proveedores, articulos where articulos.id_proveedor = proveedores.id and articulos.id = $1', [
                    data.id_articulo
                ])

            ]).then(function (data) {
                queryProvs = 'update proveedores set a_cuenta = a_cuenta - $2, por_pagar = por_pagar + $2 where id = $1 returning id';
                if (data[0].monto_por_pagar > 0) {
                    // Solo cambiar saldos de proveedores en devolución cuando ya se acabó de pagar la prenda.
                    queryProvs = 'update proveedores set a_cuenta = a_cuenta, por_pagar = por_pagar where id = $1 returning id';
                }
                return t.batch([
                    t.one('update articulos set n_existencias = n_existencias + $2 where id = $1 returning id', [
                        data[0].unidades_vendidas,
                        data[1].item_id
                    ]),
                    t.one(queryProvs, [
                        data[1].id_prov,
                        numericCol(data[1].costo_item * data[0].unidades_vendidas)
                    ]),
                    t.one('update ventas set saldo_pendiente = saldo_pendiente - $2, precio_venta = precio_venta - $3 where id = $1 returning id', [
                        data[0].id_venta,
                        data[0].monto_por_pagar,
                        numericCol(data[0].monto_por_pagar + data[0].monto_pagado)
                    ])
                ]);
            });
        });

    }).then(function (data) {
        console.log('Se ha registrado la devolución ', data);
        res.json({
            status: 'Ok',
            message: 'Se ha registrado la devolución.'
        })
    }).catch(function (error) {
        console.log(error);
        res.send('<b>Error</b>');
    })
});

router.post('/notes/finitPayment', isAuthenticated, function (req, res) {
    console.log(req.body.id);
    db_conf.db.tx(function (t) {
        var query = '';
        if (req.body.optradio == 'tar') {
            query = "update ventas set monto_pagado_tarjeta = monto_pagado_tarjeta + saldo_pendiente, " +
                "saldo_pendiente = 0 where id = $1 returning id";
        } else {
            query = "update ventas set monto_pagado_efectivo = monto_pagado_efectivo + saldo_pendiente, " +
                "saldo_pendiente = 0 where id = $1 returning id"
        }
        return t.batch([
            t.one(query, [
                req.body.id
            ]),
            t.manyOrNone("select * from venta_articulos, articulos, proveedores where venta_articulos.id_articulo = articulos.id and " +
                " proveedores.id = articulos.id_proveedor and id_venta = $1 and (monto_por_pagar > 0 or estatus = 'modificacion')", [
                req.body.id
            ]),
            t.manyOrNone("select venta_articulos.id as id_art from venta_articulos, articulos, proveedores where venta_articulos.id_articulo = articulos.id and " +
                " proveedores.id = articulos.id_proveedor and id_venta = $1 and (monto_por_pagar > 0 or estatus = 'modificacion')", [
                req.body.id
            ])
            //este then(...) va en el bloque superior
        ]).then(function (articles) {
            console.log("Articles: " + articles[1]);
            queries = [];
            queries.push(articles);
            for (var i = 0; i < articles[1].length; i++) {
                queries.push(
                    t.one("update venta_articulos set estatus = $2, monto_pagado = monto_pagado + monto_por_pagar, monto_por_pagar = 0 " +
                        " where id = $1 returning id", [
                        articles[2][i].id_art,
                        "entregada"
                    ]),
                    // Este a cuenta ya fue considerado
                    t.one("update proveedores set a_cuenta = a_cuenta + $2, por_pagar = por_pagar - $2 where id = $1 returning id", [
                        articles[1][i].id_proveedor,
                        numericCol(articles[1][i].costo)
                    ]),
                    t.one(' insert into transacciones_por_pagar (id_proveedor, tipo_transaccion, ' +
                        ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                        articles[1][i].id_proveedor,
                        'cargo',
                        'finalización de pago',
                        -numericCol(articles[1][i].costo)
                    ]),
                    t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                        ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                        articles[1][i].id_proveedor,
                        'abono',
                        'finalización de pago',
                        -numericCol(articles[1][i].costo)
                    ])
                )
            }
            return t.batch(queries);
        })
    }).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'La nota ' + data[0][0].id + ' ha sido liquidada'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al liquidar la nota'
        });
    });
});

router.post('/employee/check-out/form', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.oneOrNone('select * from usuarios where id = $1', [
        req.body.id
    ]).then(function (data) {
        res.render('partials/checkout-form', {'user': data})
    }).catch(function (error) {
        res.json({
            'status': 'Error',
            'message': 'Ocurrió un error al cargar los datos del usuario'
        })
    })
})

router.post('/employee/check-in/form', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.oneOrNone('select * from usuarios where id = $1 ', [
        req.body.id
    ]).then(function (data) {
        res.render('partials/checkin-form', {'user': data})
    }).catch(function (error) {
        console.log(error);
        res.json({
            'status': 'Error',
            'message': 'Ocurrió un error al cargar los datos del usuario'
        })
    })
});


router.post('/employee/register/check-out', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.oneOrNone('insert into asistencia (id_usuario, fecha, hora, tipo) values($1, $2, $3, $4) returning id', [
        req.body.id,
        req.body.fecha,
        req.body.salida,
        'salida'
    ]).then(function (data) {
        res.json({
            status: 'Ok',
            message: 'Se ha registrado la salida de "' + req.body.nombres + '" el día ' + req.body.fecha + ' a las ' + req.body.salida
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar la salida del usuario'
        })
    })
})

router.post('/employee/register/check-in', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.one(" select count(*) from asistencia where fecha = " +
        " $2 and tipo = 'entrada' and id_usuario = $1", [
        numericCol(req.body.id),
        req.body.fecha
    ]).then(function (data) {
        if (data.count > 0) {
            return null
        }
        return db_conf.db.oneOrNone(' insert into asistencia (id_usuario, ' +
            ' fecha, hora, tipo) values($1, $2, $3, $4) returning id', [
            req.body.id,
            req.body.fecha,
            req.body.llegada,
            'entrada'
        ])
    }).then(function (data) {
        var message = 'El usuario: ' + req.body.nombres + ' ya había sido registrado el día:  ' + req.body.fecha
        if (data) {
            message = 'Se ha registrado el ingreso de "' + req.body.nombres + '" el día ' + req.body.fecha + ' a las ' + req.body.llegada
        }
        res.json({
            status: 'Ok',
            message: message
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al registrar el ingreso del usuario'
        })
    })
});

router.post('/search/employees/checkin', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.manyOrNone("select * from usuarios where id_tienda = $1 and nombres ilike '%$2#%' and apellido_paterno ilike '%$3#%'", [
        req.body.id_tienda,
        req.body.nombres,
        req.body.apellido
    ]).then(function (data) {
        res.render('partials/search-employees-results-checkin', {
            employees: data
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar al empleado'
        })
    });
});


router.post('/search/suppliers/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.manyOrNone("select * from proveedores where nombre ilike '%$1#%'", [
        req.body.nombre
    ]).then(function (data) {
        res.render('partials/search-suppliers-results', {
            suppliers: data,
            fecha_inicial: req.body.fecha_inicial,
            fecha_final: req.body.fecha_final
        });
    }).catch(function (error) {
        console.log(error)
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar los proveedores'
        })
    })
})

router.post('/search/employees/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    db_conf.db.manyOrNone("select * from usuarios where nombres ilike '%$1#%' and (apellido_paterno ilike '%$2#%' or apellido_materno ilike '%$3#%')", [
        req.body.nombres,
        req.body.apellido_paterno,
        req.body.apellido_materno
    ]).then(function (data) {
        res.render('partials/search-employees-results', {
            employees: data,
            fecha_init: req.body.fecha_inicial,
            fecha_fin: req.body.fecha_final
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar al empleado'
        })
    });
});

router.post('/search/notes/results', isAuthenticated, function (req, res) {
    console.log(req.body);
    var query = " select ventas.id, id_nota, id_papel, precio_venta, precio_venta - acum_tot_transfer.sum as saldo_pendiente," +
        " id_tienda, nombre, fechas.fecha_venta from (select id_venta, sum(monto_pagado) from (select id_venta, " +
        " (monto_credito + monto_debito + monto_efectivo) as monto_pagado  from transferencia where " +
        " monto_credito >= 0 and monto_debito >= 0  and monto_efectivo >= 0) as acum_transfer " +
        " group by id_venta) as acum_tot_transfer, (select id_venta, min(fecha) as fecha_venta from transferencia " +
        " where (fecha >= $1 and fecha <= $2) group by id_venta) as fechas, ventas, tiendas where " +
        " acum_tot_transfer.id_venta = ventas.id and estatus = 'activa' and id_tienda = tiendas.id and " +
        " id_tienda = $5 and id_papel = $6 and fechas.id_venta = ventas.id "
    if (!req.user.permiso_administrador) {
        query = query + " and id_tienda = $4 ";
    }
    console.log("Administrador: " + req.user.permiso_administrador);
    db_conf.db.manyOrNone(query, [
        req.body.fecha_inicial,
        req.body.fecha_final,
        req.body.id_note,
        req.user.id,
        req.body.id_tienda,
        req.body.id_papel
    ]).then(function (data) {
        res.render('partials/notes/search-notes-results', {
            sales: data
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al buscar la nota'
        })
    });
});

router.get('/item/:filename/image.jpg', isAuthenticated, function (req, res) {
    img_path = path.join(__dirname, '..', 'uploads/', req.params.filename);
    //console.log( img_path );
    res.sendFile(img_path);
});


/* Borrado */
router.post('/user/delete', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from usuarios cascade where id = $1 returning id ', [req.body.id]).then(function (data) {
        console.log('Usuario eliminado: ', data.id);
        res.json({
            status: 'Ok',
            message: 'El usuario ha sido eliminado del sistema'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al borrar el usuario'
        })
    });
});


router.post('/store/delete', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from tiendas cascade where id = $1 returning id', [req.body.id]).then(function (data) {
        console.log('Tienda eliminada: ', data.id);
        res.json({
            status: 'Ok',
            message: 'La tienda ha sido eliminada del sistema'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al eliminar la tienda'
        })
    })
});


router.post('/terminal/delete', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from terminales cascade where id = $1 returning id ', [req.body.id]).then(function (data) {
        console.log('Terminal eliminada: ', data.id);
        res.json({
            status: 'Ok',
            message: 'Terminal eliminada'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al eliminar la terminal'
        });
    });
});


router.post('/supplier/delete', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from proveedores cascade where id = $1 returning id', [req.body.id]).then(function (data) {
        console.log('Proveedor eliminado: ', data.id);
        res.json({
            status: 'Ok',
            message: 'El proveedor fue eliminado del sistema'
        });
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al eliminar el proveedor'
        });
    });
});

//borrar marca
router.post('/brand/delete', isAuthenticated, function (req, res) {
    db_conf.db.one('delete from marcas where id = $1 returning id ', [req.body.id]).then(function (data) {
        console.log('Marca eliminada: ', data.id);
        res.json({
            status: 'Ok',
            message: 'La marca ha sido eliminada'
        })
    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al eliminar la marca'
        })
    });
});

//borrar artículo
router.post('/item/delete', isAuthenticated, function (req, res) {
    // Eliminar articulo
    db_conf.db.tx(function (t) {
        // Este a cuenta ya fue considerado
        return this.one("select id, costo, n_existencias, id_proveedor from articulos where id = $1 ", [req.body.id]).then(function (data) {
            return t.batch([
                t.one("delete from  nota_entrada  where id_articulo = $1 returning id", [data.id]),
                t.one("delete from  articulos  where id = $1 returning id, modelo, costo, n_existencias, id_proveedor, nombre_imagen", [data.id]),
                t.oneOrNone('update proveedores set a_cuenta= a_cuenta + $2 where id = $1 returning id, nombre', [
                    data.id_proveedor,
                    data.costo * data.n_existencias
                ]),
                t.one(' insert into transacciones_a_cuenta (id_proveedor, tipo_transaccion, ' +
                    ' fecha, concepto, monto) values($1, $2, Now(), $3, $4) returning id', [
                    data.id_proveedor,
                    'abono',
                    'Eliminación de artículo',
                    numericCol(data.costo * data.n_existencias)
                ])

            ]);
        })

    }).then(function (data) {
        console.log('Modelo articulo eliminado: ', data[1].modelo);

        // borra la imagen anterior
        /*
        if ( data[0].nombre_imagen ) {

            const img_path = path.join(__dirname, '..', 'uploads/', data[0].nombre_imagen);

            if (fs.existSync(img_path)) {
                fs.unlinkSync(img_path);
                console.log('successfully deleted ' + img_path);
            }
        }*/


        if (data[1] !== null) {
            console.log('El proveedor saldo a cuenta del proveedor ' + data[2].nombre + ' ha sido actualizado');
        }

        res.json({
            status: 'Ok',
            message: 'Artículo eliminado exitosamente, el saldo con proveedores ha sido actualizado'
        });

    }).catch(function (error) {
        console.log(error);
        res.json({
            status: 'Error',
            message: 'Ocurrió un error al eliminar el artículo'
        });
    });
});

// exportar inventario
router.get('/exportar/inventario.csv', isAuthenticated, function (req, res) {

    //articulo, marca, proveedor, tienda
    db_conf.db.manyOrNone("select articulos.id,  articulos.articulo, articulos.descripcion, marcas.nombre as marca, articulos.modelo, " +
        "(select nombre as proveedor from proveedores where id= articulos.id_proveedor)," +
        "tiendas.nombre as tienda, articulos.talla, articulos.notas, articulos.precio, articulos.costo, articulos.n_existencias as existencias " +
        "from articulos, marcas, tiendas " +
        "where articulos.id_marca = marcas.id and articulos.id_tienda = tiendas.id ").then(function (data) {

        try {
            var fields = ['id', 'articulo', 'descripcion', 'marca', 'modelo', 'proveedor', 'tienda', 'talla', 'notas', 'precio', 'costo', 'existencias'];
            var result = json2csv({data: data, fields: fields});
            //console.log(result);

            //Random file name
            var csv_path = path.join(__dirname, '..', 'csv/', req.user.usuario + '_export_items.csv');

            // write csv file
            fs.writeFile(csv_path, result, function (err) {
                if (err) throw err;
                console.log('file saved');
                res.sendFile(csv_path);
            });

        } catch (err) {
            // Errors are thrown for bad options, or if the data is empty and no fields are provided.
            // Be sure to provide fields if it is possible that your data array will be empty.
            console.error(err);
            res.send("<p>Ocurrió un error al exportar el inventario</p>" +
                "<p><a href='/inventario/'>Regresar</a></p>");
        }

    }).catch(function (error) {
        console.log(error);
        res.send("<p>Ocurrió un error al exportar el inventario</p>" +
            "<p><a href='/inventario/'>Regresar</a></p>");
    });
});

router.get('/exportar/proveedores.csv', isAuthenticated, function (req, res) {
    db_conf.db.manyOrNone('select id, nombre, razon_social, rfc, a_cuenta, por_pagar from proveedores').then(function (data) {

        try {
            var fields = ['id', 'nombre', 'razon_social', 'rfc', 'a_cuenta', 'por_pagar'];
            var result = json2csv({data: data, fields: fields});
            //console.log(result);

            //Random file name
            var csv_path = path.join(__dirname, '..', 'csv/', req.user.usuario + '_export_suppliers.csv');

            // write csv file
            fs.writeFile(csv_path, result, function (err) {
                if (err) throw err;
                console.log('file saved');
                res.sendFile(csv_path);
            });

        } catch (err) {
            // Errors are thrown for bad options, or if the data is empty and no fields are provided.
            // Be sure to provide fields if it is possible that your data array will be empty.
            console.error(err);
            res.send("<p>Ocurrió un error al exportar los proveedores</p>" +
                "<p><a href='/inventario/'>Regresar</a></p>");
        }

    }).catch(function (error) {
        console.log(error);
        res.send("<p>Ocurrió un error al exportar los proveedores</p>" +
            "<p><a href='/inventario/'>Regresar</a></p>");
    });

});

router.get('/exportar/ventas.csv', isAuthenticated, function (req, res) {
    db_conf.db.manyOrNone('select ventas.id as id_venta, usuarios.usuario as vendedor, ventas.precio_venta as total_venta, ventas.fecha_venta as fecha, tiendas.nombre as tienda, ' +
        ' ventas.hora_venta as hora, ventas.monto_pagado_efectivo as monto_pagado_efectivo_venta, ventas.monto_pagado_tarjeta as monto_pagado_tarjeta_venta, ventas.tarjeta_credito, ventas.saldo_pendiente ' +
        ' as saldo_pendiente_venta, ventas.estatus as estatus_venta, proveedores.nombre as proveedor,' +
        ' (select nombre as tienda_facturacion from tiendas where id = terminales.id_tienda), ' +
        ' (select nombre_facturador as terminal from terminales where id = ventas.id_terminal), articulos.articulo as nombre_articulo, venta_articulos.unidades_vendidas, ' +
        ' venta_articulos.monto_pagado as monto_pagado_articulo, venta_articulos.monto_por_pagar as monto_por_pagar_articulo, venta_articulos.estatus as estatus_articulo ' +
        ' from ventas, usuarios,  terminales, venta_articulos, articulos, tiendas, proveedores where ventas.id_usuario = usuarios.id and ' +
        ' ventas.id_tienda = tiendas.id and ventas.id = venta_articulos.id_venta and ' +
        ' articulos.id = venta_articulos.id_articulo and articulos.id_proveedor = proveedores.id').then(function (data) {

        try {
            var fields = ['id_venta', 'vendedor', 'tienda', 'tienda_facturacion', 'total_venta', 'fecha', 'hora', 'monto_pagado_efectivo_venta',
                'monto_pagado_tarjeta_venta', 'tarjeta_credito', 'saldo_pendiente_venta', 'estatus_venta', 'terminal',
                'nombre_articulo', 'proveedor', 'unidades_vendidas', 'monto_pagado_articulo', 'monto_por_pagar_articulo', 'estatus_articulo'];
            var result = json2csv({data: data, fields: fields});
            //console.log(result);

            //Random file name
            var csv_path = path.join(__dirname, '..', 'csv/', req.user.usuario + '_export_sales.csv');

            // write csv file
            fs.writeFile(csv_path, result, function (err) {
                if (err) throw err;
                console.log('file saved');
                res.sendFile(csv_path);
            });

        } catch (err) {
            // Errors are thrown for bad options, or if the data is empty and no fields are provided.
            // Be sure to provide fields if it is possible that your data array will be empty.
            console.error(err);
            res.send("<p>Ocurrió un error al exportar las ventas</p>" +
                "<p><a href='/inventario/'>Regresar</a></p>");
        }

    }).catch(function (error) {
        console.log(error);
        res.send("<p>Ocurrió un error al exportar las ventas</p>" +
            "<p><a href='/inventario/'>Regresar</a></p>");
    });

});

module.exports = router;
