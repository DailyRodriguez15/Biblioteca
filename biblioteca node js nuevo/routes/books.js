const express = require("express");
const router = express.Router();
const dbConn = require("../lib/db");
const multer = require("multer");
const path = require("path");

// ====================== CONFIGURACIÓN DE MULTER ======================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../public/uploads"));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// ====================== MIDDLEWARE DE AUTENTICACIÓN Y ROLES ======================
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/books/login");
}

function requireRole(role) {
  return function (req, res, next) {
    if (req.session.user && req.session.user.rol === role) return next();
    res.redirect("/books/login");
  };
}

// AGREGAR LIBRO (POST)
router.post("/libro/add", isAuthenticated, requireRole("admin"), (req, res) => {
  const {
    isbn,
    name,
    autor_id,
    editorial_id,
    categoria_id,
    anio_publicacion,
    num_paginas,
    ejemplares,  // <--- NUEVO
    estado,
  } = req.body;
  if (
    !isbn ||
    !name ||
    !autor_id ||
    !editorial_id ||
    !categoria_id ||
    !anio_publicacion ||
    !num_paginas ||
    !ejemplares ||     // <--- NUEVO
    !estado
  ) {
    if (req.headers["content-type"] === "application/json") {
      return res.json({
        success: false,
        message: "Todos los campos son obligatorios.",
      });
    }
    req.flash("error", "Todos los campos son obligatorios.");
    return res.redirect("/books/libro");
  }
  let prestado = 0,
    reservado = 0;
  if (estado === "Prestado") prestado = 1;
  if (estado === "Reservado") reservado = 1;

  dbConn.query(
    "INSERT INTO books SET ?",
    {
      isbn,
      name,
      autor_id,
      editorial_id,
      categoria_id,
      anio_publicacion,
      num_paginas,
      ejemplares,   // <--- NUEVO
      estado,
      prestado,
      reservado,
    },
    (err) => {
      if (req.headers["content-type"] === "application/json") {
        return res.json({
          success: !err,
          message: err ? "Error al guardar." : "Libro guardado correctamente.",
        });
      }
      if (err) req.flash("error", "Error al guardar.");
      else req.flash("success", "Libro guardado correctamente.");
      res.redirect("/books/libro");
    }
  );
});

// EDITAR LIBRO (POST)
router.post(
  "/libro/edit/:id",
  isAuthenticated,
  requireRole("admin"),
  (req, res) => {
    const {
      isbn,
      name,
      autor_id,
      editorial_id,
      categoria_id,
      anio_publicacion,
      num_paginas,
      ejemplares,   // <--- NUEVO
      estado,
    } = req.body;
    const id = req.params.id;
    if (
      !isbn ||
      !name ||
      !autor_id ||
      !editorial_id ||
      !categoria_id ||
      !anio_publicacion ||
      !num_paginas ||
      !ejemplares ||   // <--- NUEVO
      !estado
    ) {
      if (req.headers["content-type"] === "application/json") {
        return res.json({
          success: false,
          message: "Todos los campos son obligatorios.",
        });
      }
      req.flash("error", "Todos los campos son obligatorios.");
      return res.redirect("/books/libro");
    }
    let prestado = 0,
      reservado = 0;
    if (estado === "Prestado") prestado = 1;
    if (estado === "Reservado") reservado = 1;

    dbConn.query(
      `UPDATE books SET isbn=?, name=?, autor_id=?, editorial_id=?, categoria_id=?, anio_publicacion=?, num_paginas=?, ejemplares=?, estado=?, prestado=?, reservado=? WHERE id=?`,
      [
        isbn,
        name,
        autor_id,
        editorial_id,
        categoria_id,
        anio_publicacion,
        num_paginas,
        ejemplares,   // <--- NUEVO
        estado,
        prestado,
        reservado,
        id,
      ],
      (err) => {
        if (req.headers["content-type"] === "application/json") {
          return res.json({
            success: !err,
            message: err
              ? "Error al actualizar."
              : "Libro actualizado correctamente.",
          });
        }
        if (err) req.flash("error", "Error al actualizar.");
        else req.flash("success", "Libro actualizado correctamente.");
        res.redirect("/books/libro");
      }
    );
  }
);

// ========== RUTA: ELIMINAR LIBRO ==========
router.get(
  "/libro/delete/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res) {
    const id = req.params.id;
    dbConn.query("DELETE FROM books WHERE id = ?", [id], function (err) {
      if (err) {
        req.flash("error", "Error al eliminar el libro.");
      } else {
        req.flash("success", "Libro eliminado correctamente.");
      }
      res.redirect("/books/libro");
    });
  }
);

// ====================== RESERVAS: Liberar/Entregar ======================
router.post(
  "/books/bibliotecario/reservas/entregar",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    const { reserva_id } = req.body;
    dbConn.query(
      "SELECT libro FROM reservas WHERE id = ?",
      [reserva_id],
      function (err, rows) {
        if (err || rows.length === 0)
          return res.redirect("/books/bibliotecario");
        const libroId = rows[0].libro;
        // Marca la reserva como entregada y el libro como disponible (reservado=0)
        dbConn.query(
          "UPDATE reservas SET estado='Entregada' WHERE id = ?",
          [reserva_id],
          function (err2) {
            dbConn.query(
              "UPDATE books SET reservado=0 WHERE id = ?",
              [libroId],
              function (err3) {
                res.redirect("/books/bibliotecario");
              }
            );
          }
        );
      }
    );
  }
);

// ====================== PRÉSTAMOS: Registrar devolución ======================
router.post(
  "/books/bibliotecario/prestamos/devolver",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    const { prestamo_id } = req.body;
    dbConn.query(
      "SELECT * FROM prestamos WHERE id = ?",
      [prestamo_id],
      function (err, rows) {
        if (err || rows.length === 0)
          return res.redirect("/books/bibliotecario");
        const prestamo = rows[0];
        const libroId = prestamo.libro;
        // Marca el préstamo como devuelto y el libro como disponible
        dbConn.query(
          "UPDATE prestamos SET estado='Devuelto' WHERE id = ?",
          [prestamo_id],
          function (err2) {
            dbConn.query(
              "UPDATE books SET prestado=0 WHERE id = ?",
              [libroId],
              function (err3) {
                res.redirect("/books/bibliotecario");
              }
            );
          }
        );
      }
    );
  }
);

// ====================== DEVOLVER AL USUARIO ======================
router.post("/prestamos/devolver", isAuthenticated, requireRole("usuario"), function (req, res) {
  const { libro, usuario } = req.body;
  dbConn.query(
    "UPDATE prestamos SET estado='Devuelto', fecha_devolucion=CURDATE() WHERE libro=? AND usuario=? AND estado='Activo'",
    [libro, usuario],
    function (err) {
      if (!err) {
        dbConn.query("UPDATE books SET prestado=0 WHERE id=?", [libro]);
      }
      req.flash(err ? "error" : "success", err ? "Error al devolver el libro." : "¡Libro devuelto correctamente!");
      res.redirect("/books/usuario");
    }
  );
});

// ====================== LIBROS ======================
router.get(
  "/libro",
  isAuthenticated,
  requireRole("admin"),
  function (req, res) {
    dbConn.query(
      `SELECT books.*, autores.nombre AS autor, editoriales.nombre AS editorial, categorias.nombre AS categoria
     FROM books
     LEFT JOIN autores ON books.autor_id = autores.id
     LEFT JOIN editoriales ON books.editorial_id = editoriales.id
     LEFT JOIN categorias ON books.categoria_id = categorias.id
     ORDER BY books.id DESC`,
      function (err, libros) {
        if (err) libros = [];
        dbConn.query(
          "SELECT id, nombre FROM autores WHERE estado = 'Activo' ORDER BY nombre ASC",
          function (err2, autores) {
            if (err2) autores = [];
            dbConn.query(
              "SELECT id, nombre FROM editoriales WHERE estado = 'Activo' ORDER BY nombre ASC",
              function (err3, editoriales) {
                if (err3) editoriales = [];
                dbConn.query(
                  "SELECT id, nombre FROM categorias WHERE estado = 'Activo' ORDER BY nombre ASC",
                  function (err4, categorias) {
                    if (err4) categorias = [];
                    res.render("books/libro", {
                      data: libros,
                      autores,
                      editoriales,
                      categorias,
                      messages: req.flash(),
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  }
);

// ====================== RESERVAS ======================
// Crear una reserva
router.post("/reservas/add", isAuthenticated, function (req, res, next) {
  const { libro, usuario } = req.body;
  dbConn.query(
    "SELECT prestado, reservado FROM books WHERE id = ?",
    [libro],
    function (err, rows) {
      if (err || rows.length === 0) {
        req.flash("error", "Libro no encontrado.");
        return res.redirect("/books/usuario");
      }
      if (rows[0].prestado || rows[0].reservado) {
        req.flash("error", "El libro ya está prestado o reservado.");
        return res.redirect("/books/usuario");
      }
      dbConn.query(
        "INSERT INTO reservas (libro, usuario, fecha_reserva, estado) VALUES (?, ?, CURDATE(), 'Pendiente')",
        [libro, usuario],
        function (err2) {
          if (err2) {
            req.flash("error", "Error al registrar la reserva.");
            return res.redirect("/books/usuario");
          }
          dbConn.query(
            "UPDATE books SET reservado = 1 WHERE id = ?",
            [libro],
            function (err3) {
              if (err3) {
                req.flash(
                  "warning",
                  "Reserva registrada, pero no se pudo actualizar el estado del libro."
                );
                return res.redirect("/books/usuario");
              }
              req.flash("success", "¡Reserva realizada correctamente!");
              return res.redirect("/books/usuario");
            }
          );
        }
      );
    }
  );
});

// Liberar/Entregar reserva (bibliotecario)
router.post(
  "/bibliotecario/reservas/entregar",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    const { reserva_id } = req.body;
    dbConn.query(
      "SELECT libro FROM reservas WHERE id = ?",
      [reserva_id],
      function (err, rows) {
        if (err || rows.length === 0)
          return res.redirect("/books/bibliotecario");
        const libroId = rows[0].libro;
        dbConn.query("UPDATE reservas SET estado='Entregada' WHERE id = ?", [
          reserva_id,
        ]);
        dbConn.query("UPDATE books SET reservado=0 WHERE id = ?", [libroId]);
        res.redirect("/books/bibliotecario");
      }
    );
  }
);

// ====================== MULTAS ======================
// Registrar devolución (bibliotecario) y calcular multa si aplica
router.post(
  "/bibliotecario/prestamos/devolver",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    const { prestamo_id } = req.body;
    dbConn.query(
      "SELECT * FROM prestamos WHERE id = ?",
      [prestamo_id],
      function (err, rows) {
        if (err || rows.length === 0)
          return res.redirect("/books/bibliotecario");
        const prestamo = rows[0];
        const fechaDevolucionReal = new Date();
        const fechaLimite = new Date(prestamo.fecha_devolucion);
        const libroId = prestamo.libro;
        let diasRetraso = Math.ceil(
          (fechaDevolucionReal - fechaLimite) / (1000 * 60 * 60 * 24)
        );
        if (diasRetraso > 0) {
          let monto = diasRetraso * 1000; // $1000 por día de retraso
          dbConn.query(
            "INSERT INTO multas (usuario, libro, monto, estado) VALUES (?, ?, ?, 'Pendiente')",
            [prestamo.usuario, libroId, monto]
          );
        }
        dbConn.query("UPDATE prestamos SET estado='Devuelto' WHERE id = ?", [
          prestamo_id,
        ]);
        dbConn.query("UPDATE books SET prestado=0 WHERE id = ?", [libroId]);
        res.redirect("/books/bibliotecario");
      }
    );
  }
);

// Registrar pago de multa (bibliotecario)
router.post(
  "/books/bibliotecario/multas/pagar",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    const { multa_id } = req.body;
    dbConn.query(
      "UPDATE multas SET estado='Pagada' WHERE id = ?",
      [multa_id],
      function (err) {
        res.redirect("/books/bibliotecario");
      }
    );
  }
);

router.get("/api/autores", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT id, nombre FROM autores WHERE estado = 'Activo' ORDER BY nombre ASC",
    function (err, rows) {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

router.get("/api/editoriales", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT id, nombre FROM editoriales WHERE estado = 'Activo' ORDER BY nombre ASC",
    function (err, rows) {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

router.get("/api/categorias", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT id, nombre FROM categorias WHERE estado = 'Activo' ORDER BY nombre ASC",
    function (err, rows) {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

router.get("/api/libro/:id", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT * FROM books WHERE id = ?",
    [req.params.id],
    function (err, rows) {
      if (err || rows.length === 0) return res.json({});
      res.json(rows[0]);
    }
  );
});

router.post(
  "/add",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    const { name, autor_id, editorial_id, categoria_id, prestado } = req.body;
    if (
      !name ||
      !autor_id ||
      !editorial_id ||
      !categoria_id ||
      prestado === undefined
    ) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    let form_data = {
      name,
      autor_id,
      editorial_id,
      categoria_id,
      prestado,
    };
    dbConn.query("INSERT INTO books SET ?", form_data, function (err) {
      if (err) {
        console.error("Error al agregar el libro:", err);
        return res.json({
          success: false,
          message: "Error al agregar el libro",
        });
      }
      res.json({ success: true });
    });
  }
);

router.post(
  "/update/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    const { name, autor_id, editorial_id, categoria_id, prestado } = req.body;
    if (
      !name ||
      !autor_id ||
      !editorial_id ||
      !categoria_id ||
      prestado === undefined
    ) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    let sql =
      "UPDATE books SET name=?, autor_id=?, editorial_id=?, categoria_id=?, prestado=? WHERE id=?";
    let params = [name, autor_id, editorial_id, categoria_id, prestado, id];
    dbConn.query(sql, params, function (err) {
      if (err) {
        console.error("Error al actualizar el libro:", err);
        return res.json({
          success: false,
          message: "Error al actualizar el libro",
        });
      }
      res.json({ success: true });
    });
  }
);

router.get(
  "/delete/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    dbConn.query("DELETE FROM books WHERE id = ?", [id], function (err) {
      if (err) {
        req.flash("error", "Error al eliminar el libro");
      } else {
        req.flash("success", "Libro eliminado exitosamente");
      }
      res.redirect("/books/libro");
    });
  }
);

// ====================== LOGIN/REGISTRO ======================
router.get("/login", function (req, res, next) {
  res.render("books/login", { messages: req.flash() });
});

// ====================== RUTA ACERCA ======================
router.get("/acerca", function (req, res, next) {
  res.render("books/acerca", { messages: req.flash() });
});

router.post("/login", function (req, res, next) {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash("error", "Completa todos los campos.");
    return res.redirect("/books/login");
  }
  dbConn.query(
    "SELECT * FROM usuarios WHERE email = ?",
    [email],
    async function (err, rows) {
      if (err || rows.length === 0) {
        req.flash("error", "Correo o contraseña incorrectos.");
        return res.redirect("/books/login");
      }
      const user = rows[0];
      // Comparar directamente en texto plano
      if (password !== user.password) {
        req.flash("error", "Correo o contraseña incorrectos.");
        return res.redirect("/books/login");
      }
      // Guardar usuario en sesión
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        rol: user.rol,
      };
      // Redirigir según rol
      if (user.rol === "admin") {
        return res.redirect("/books/dashboard");
      } else if (user.rol === "bibliotecario") {
        return res.redirect("/books/bibliotecario");
      } else {
        return res.redirect("/books/usuario");
      }
    }
  );
});

router.get("/recuperar", function (req, res, next) {
  res.render("books/recuperar", { messages: req.flash() });
});

router.get("/registro", function (req, res, next) {
  res.render("books/registro", { messages: req.flash() });
});

router.post("/registro", async function (req, res, next) {
  const { username, email, password, confirm_password } = req.body;
  if (!username || !email || !password || password !== confirm_password) {
    req.flash("error", "Verifica los datos ingresados.");
    return res.redirect("/books/registro");
  }
  dbConn.query(
    "SELECT * FROM usuarios WHERE username = ? OR email = ?",
    [username, email],
    async function (err, rows) {
      if (err) {
        req.flash("error", "Error en la base de datos.");
        return res.redirect("/books/registro");
      }
      if (rows.length > 0) {
        req.flash("error", "El usuario o correo ya existe.");
        return res.redirect("/books/registro");
      }
      // Guarda la contraseña en texto plano, SIN bcrypt
      const hash = password;
      // Siempre el registro es usuario normal
      dbConn.query(
        "INSERT INTO usuarios (username, email, password, rol) VALUES (?, ?, ?, ?)",
        [username, email, hash, "usuario"],
        function (err) {
          if (err) {
            req.flash("error", "Error al registrar usuario.");
            return res.redirect("/books/registro");
          }
          req.flash(
            "success",
            "¡Registro exitoso! Ahora puedes iniciar sesión."
          );
          res.redirect("/books/login");
        }
      );
    }
  );
});

// ====================== PANEL ADMIN ======================
router.get(
  "/dashboard",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let totales = {};
    dbConn.query(
      "SELECT COUNT(*) AS totalLibros FROM books",
      function (err, libros) {
        if (err) return next(err);
        totales.libros = libros[0].totalLibros;
        dbConn.query(
          "SELECT COUNT(*) AS totalEditoriales FROM editoriales",
          function (err, editoriales) {
            if (err) return next(err);
            totales.editoriales = editoriales[0].totalEditoriales;
            dbConn.query(
              "SELECT COUNT(*) AS totalPrestamos FROM prestamos WHERE estado = 'Activo'",
              function (err, prestamos) {
                if (err) return next(err);
                totales.prestamos = prestamos[0].totalPrestamos;
                res.render("books/dashboard", {
                  user: req.session.user,
                  totalLibros: totales.libros,
                  totalEditoriales: totales.editoriales,
                  totalPrestamos: totales.prestamos,
                  activePage: "dashboard",
                });
              }
            );
          }
        );
      }
    );
  }
);

// ====================== PANEL BIBLIOTECARIO ======================
router.get(
  "/bibliotecario",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res) {
    // Libros disponibles (no prestados ni reservados)
    dbConn.query(
      `SELECT books.*, autores.nombre AS autor, editoriales.nombre AS editorial, categorias.nombre AS categoria 
     FROM books 
     LEFT JOIN autores ON books.autor_id = autores.id
     LEFT JOIN editoriales ON books.editorial_id = editoriales.id
     LEFT JOIN categorias ON books.categoria_id = categorias.id
     WHERE books.prestado = 0 AND books.reservado = 0`,
      function (err, libros) {
        if (err) libros = [];
        // Préstamos activos
        dbConn.query(
          `SELECT prestamos.*, books.name AS libro_nombre, usuarios.username AS usuario_nombre
         FROM prestamos
         JOIN books ON prestamos.libro = books.id
         JOIN usuarios ON prestamos.usuario = usuarios.id
         WHERE prestamos.estado = 'Activo'
         ORDER BY prestamos.id DESC`,
          function (err2, prestamos) {
            if (err2) prestamos = [];
            // Reservas
            dbConn.query(
              `SELECT reservas.*, books.name AS libro_nombre, usuarios.username AS usuario_nombre
             FROM reservas
             JOIN books ON reservas.libro = books.id
             JOIN usuarios ON reservas.usuario = usuarios.id
             WHERE reservas.estado = 'Pendiente'
             ORDER BY reservas.id DESC`,
              function (err3, reservas) {
                if (err3) reservas = [];
                // Multas
                dbConn.query(
                  `SELECT multas.*, usuarios.username AS usuario_nombre, books.name AS libro_nombre
                 FROM multas
                 JOIN usuarios ON multas.usuario = usuarios.id
                 JOIN books ON multas.libro = books.id
                 WHERE multas.estado = 'Pendiente'
                 ORDER BY multas.id DESC`,
                  function (err4, multas) {
                    if (err4) multas = [];
                    // Reportes rápidos
                    multiReportes(function (reportes) {
                      const totalLibros = libros.length;
                      const totalPrestamos = prestamos.length;
                      const totalReservas = reservas.length;
                      const totalMultas = multas.length;
                      res.render("books/bibliotecario", {
                        user: req.session.user,
                        libros,
                        prestamos,
                        reservas,
                        multas,
                        totalLibros,
                        totalPrestamos,
                        totalReservas,
                        totalMultas,
                        reportes,
                      });
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  }
);

// Función para reportes rápidos (libros más prestados, usuarios activos, multas recientes)
function multiReportes(callback) {
  let reportes = { masPrestados: [], usuariosActivos: [], multasRecientes: [] };
  // Libros más prestados (top 5)
  dbConn.query(
    `SELECT books.name AS nombre, COUNT(prestamos.id) AS cantidad
     FROM prestamos
     JOIN books ON prestamos.libro = books.id
     GROUP BY books.name
     ORDER BY cantidad DESC
     LIMIT 5`,
    function (err, libros) {
      if (!err && libros.length) reportes.masPrestados = libros;
      // Usuarios más activos (top 5)
      dbConn.query(
        `SELECT usuarios.username AS nombre, COUNT(prestamos.id) AS prestamos
         FROM prestamos
         JOIN usuarios ON prestamos.usuario = usuarios.id
         GROUP BY usuarios.username
         ORDER BY prestamos DESC
         LIMIT 5`,
        function (err2, usuarios) {
          if (!err2 && usuarios.length) reportes.usuariosActivos = usuarios;
          // Multas recientes (top 5)
          dbConn.query(
            `SELECT multas.monto, usuarios.username AS usuario_nombre
             FROM multas
             JOIN usuarios ON multas.usuario = usuarios.id
             ORDER BY multas.id DESC
             LIMIT 5`,
            function (err3, multas) {
              if (!err3 && multas.length) reportes.multasRecientes = multas;
              callback(reportes);
            }
          );
        }
      );
    }
  );
}

// ====================== PANEL USUARIO ======================
router.get(
  "/usuario",
  isAuthenticated,
  requireRole("usuario"),
  function (req, res, next) {
    dbConn.query(
      `SELECT books.*, autores.nombre AS autor, editoriales.nombre AS editorial, categorias.nombre AS categoria
       FROM books
       LEFT JOIN autores ON books.autor_id = autores.id
       LEFT JOIN editoriales ON books.editorial_id = editoriales.id
       LEFT JOIN categorias ON books.categoria_id = categorias.id
       ORDER BY books.id DESC`,
      function (err, libros) {
        if (err) libros = [];

        // --- Consulta préstamos activos para calcular ejemplares disponibles ---
        dbConn.query(
          "SELECT libro, COUNT(*) AS cantidad FROM prestamos WHERE estado='Activo' GROUP BY libro",
          function (errPrestamos, prestamoRows) {
            // Mapeo: libro.id => cantidad de ejemplares prestados
            const prestadosMap = {};
            if (!errPrestamos) {
              prestamoRows.forEach(p => {
                prestadosMap[p.libro] = p.cantidad;
              });
            }

            // --- Marcar ejemplares_disponibles en cada libro ---
            libros.forEach(libro => {
              // Si no tienes campo ejemplares en books, usa 1 como mínimo (pero deberías tenerlo)
              const total = Number(libro.ejemplares) || 1;
              const prestados = Number(prestadosMap[libro.id]) || 0;
              libro.ejemplares_disponibles = Math.max(total - prestados, 0);
            });

            // --- Consulta autores ---
            dbConn.query(
              "SELECT * FROM autores WHERE estado = 'Activo'",
              function (err2, autores) {
                if (err2) autores = [];

                // --- Consulta categorías ---
                dbConn.query(
                  "SELECT * FROM categorias WHERE estado = 'Activo'",
                  function (err3, categorias) {
                    if (err3) categorias = [];

                    // --- Consulta reservas pendientes ---
                    dbConn.query(
                      "SELECT libro, usuario FROM reservas WHERE estado = 'Pendiente'",
                      function (err4, reservas) {
                        if (err4) reservas = [];
                        const reservadoIds = reservas.map((r) => r.libro);
                        const reservadoPorUsuario = {};
                        reservas.forEach(r => {
                          reservadoPorUsuario[r.libro] = r.usuario; // para saber quién reservó
                        });

                        // Marca libro.reservado y libro.usuario_reserva según corresponda
                        libros.forEach(libro => {
                          libro.reservado = reservadoIds.includes(libro.id) ? 1 : 0;
                          libro.usuario_reserva = reservadoPorUsuario[libro.id] || null;
                        });

                        // --------> HISTORIAL DE PRÉSTAMOS DEL USUARIO <----------
                        dbConn.query(
                          `SELECT prestamos.*, books.name AS libro_nombre
                           FROM prestamos
                           JOIN books ON prestamos.libro = books.id
                           WHERE prestamos.usuario = ?
                           ORDER BY prestamos.fecha_prestamo DESC`,
                          [req.session.user.id],
                          function (err5, historialPrestamos) {
                            if (err5) historialPrestamos = [];

                            // --------> LIBROS MÁS PRESTADOS <----------
                            dbConn.query(
                              `SELECT books.*, autores.nombre AS autor,
                                    COUNT(prestamos.id) AS veces_prestado
                               FROM books
                               LEFT JOIN autores ON books.autor_id = autores.id
                               LEFT JOIN prestamos ON prestamos.libro = books.id
                               GROUP BY books.id
                               ORDER BY veces_prestado DESC
                               LIMIT 5`,
                              function (err6, librosMasPrestados) {
                                if (err6) librosMasPrestados = [];
                                res.render("books/usuario", {
                                  user: req.session.user,
                                  libros,
                                  autores,
                                  categorias,
                                  messages: req.flash(),
                                  historialPrestamos,
                                  librosMasPrestados
                                });
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  }
);

// ====================== PANEL ADMIN - PRÉSTAMOS ======================
router.get(
  "/prestamos/admin",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    dbConn.query(
      `SELECT 
        prestamos.id,
        usuarios.username AS nombre_usuario,
        usuarios.email AS email_usuario,
        books.name AS titulo_libro,
        autores.nombre AS autor_libro,
        prestamos.fecha_prestamo AS fecha_entrega,
        prestamos.fecha_devolucion,
        prestamos.estado
     FROM prestamos
     JOIN books ON prestamos.libro = books.id
     JOIN usuarios ON prestamos.usuario = usuarios.id
     JOIN autores ON books.autor_id = autores.id
     ORDER BY prestamos.id DESC`,
      function (err, rows) {
        if (err) {
          req.flash("error", "Error al obtener los préstamos");
          return res.render("books/prestamos_admin", {
            prestamos: [],
            messages: req.flash(),
            activePage: "prestamos",
          });
        }
        res.render("books/prestamos_admin", {
          prestamos: rows,
          messages: req.flash(),
          activePage: "prestamos",
        });
      }
    );
  }
);

// ====================== PRÉSTAMOS - USUARIO (solo sus préstamos) ======================
router.get("/prestamos", isAuthenticated, function (req, res, next) {
  const usuarioActual = req.session.user.id;
  dbConn.query(
    `SELECT 
        prestamos.id,
        usuarios.username AS nombre_usuario,
        books.name AS titulo_libro,
        autores.nombre AS autor_libro,
        prestamos.fecha_prestamo AS fecha_entrega,
        prestamos.fecha_devolucion
     FROM prestamos
     JOIN books ON prestamos.libro = books.id
     JOIN usuarios ON prestamos.usuario = usuarios.id
     JOIN autores ON books.autor_id = autores.id
     WHERE prestamos.estado = 'Activo' AND prestamos.usuario = ?
     ORDER BY prestamos.id DESC`,
    [usuarioActual],
    function (err, rows) {
      if (err) {
        req.flash("error", "Error al obtener los préstamos");
        return res.render("books/prestamos", {
          prestamos: [],
          messages: req.flash(),
        });
      }
      res.render("books/prestamos", { prestamos: rows, messages: req.flash() });
    }
  );
});

router.get("/prestamos/libros", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT id, name, prestado FROM books ORDER BY name ASC",
    function (err, rows) {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

// Permite préstamo desde usuario o bibliotecario según el rol
router.post("/prestamos/add", isAuthenticated, function (req, res, next) {
  let { libro, usuario, fecha_prestamo, fecha_devolucion, estado } = req.body;
  if (!libro || !usuario || !fecha_prestamo || !fecha_devolucion || !estado) {
    req.flash("error", "Por favor, complete todos los campos.");
    return res.redirect("/books/usuario");
  }
  if (estado === "Prestado") estado = "Activo";

  // Primero, verificar si hay ejemplares disponibles
  dbConn.query(
    "SELECT ejemplares FROM books WHERE id = ?",
    [libro],
    function (err, rows) {
      if (err || rows.length === 0) {
        req.flash("error", "Error al verificar ejemplares.");
        return res.redirect("/books/usuario");
      }
      if (rows[0].ejemplares <= 0) {
        req.flash("error", "No hay ejemplares disponibles para prestar.");
        return res.redirect("/books/usuario");
      }

      // Insertar el préstamo
      dbConn.query(
        "INSERT INTO prestamos (libro, usuario, fecha_prestamo, fecha_devolucion, estado) VALUES (?, ?, ?, ?, ?)",
        [libro, usuario, fecha_prestamo, fecha_devolucion, estado],
        function (err2) {
          if (err2) {
            req.flash("error", "Error al registrar el préstamo.");
            return res.redirect("/books/usuario");
          }
          if (estado === "Activo") {
            // Marcar libro como prestado y descontar ejemplar
            dbConn.query(
              "UPDATE books SET prestado = 1, ejemplares = ejemplares - 1 WHERE id = ? AND ejemplares > 0",
              [libro],
              function (err3) {
                if (err3) {
                  req.flash(
                    "warning",
                    "Préstamo registrado, pero no se pudo actualizar el estado del libro."
                  );
                  return res.redirect("/books/usuario");
                }
                req.flash("success", "¡Préstamo realizado correctamente!");
                return res.redirect("/books/usuario");
              }
            );
          } else {
            req.flash("success", "¡Préstamo registrado!");
            return res.redirect("/books/usuario");
          }
        }
      );
    }
  );
});

router.post(
  "/prestamos/edit/:id",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    let id = req.params.id;
    let { libro, usuario, fecha_prestamo, fecha_devolucion, estado } = req.body;
    if (!libro || !usuario || !fecha_prestamo || !fecha_devolucion || !estado) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    if (estado === "Prestado") estado = "Activo";
    dbConn.query(
      "UPDATE prestamos SET libro = ?, usuario = ?, fecha_prestamo = ?, fecha_devolucion = ?, estado = ? WHERE id = ?",
      [libro, usuario, fecha_prestamo, fecha_devolucion, estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al editar el préstamo.",
          });
        }
        let prestado = estado === "Activo" ? 1 : 0;
        dbConn.query(
          "UPDATE books SET prestado = ? WHERE id = ?",
          [prestado, libro],
          function (err2) {
            if (err2) {
              return res.json({
                success: false,
                message:
                  "Préstamo editado, pero no se pudo actualizar el estado del libro.",
              });
            }
            res.json({ success: true });
          }
        );
      }
    );
  }
);

router.post(
  "/prestamos/estado/:id",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    let id = req.params.id;
    let { estado } = req.body;
    if (!estado) {
      return res.json({ success: false, message: "Estado no válido." });
    }
    if (estado === "Prestado") estado = "Activo";
    dbConn.query(
      "SELECT libro FROM prestamos WHERE id = ?",
      [id],
      function (err, rows) {
        if (err || rows.length === 0) {
          return res.json({
            success: false,
            message: "Préstamo no encontrado.",
          });
        }
        const libroId = rows[0].libro;
        dbConn.query(
          "UPDATE prestamos SET estado = ? WHERE id = ?",
          [estado, id],
          function (err2) {
            if (err2) {
              return res.json({
                success: false,
                message: "Error al cambiar el estado del préstamo.",
              });
            }
            let prestado = estado === "Activo" ? 1 : 0;
            dbConn.query(
              "UPDATE books SET prestado = ? WHERE id = ?",
              [prestado, libroId],
              function (err3) {
                if (err3) {
                  return res.json({
                    success: false,
                    message:
                      "Estado del préstamo cambiado, pero no se pudo actualizar el libro.",
                  });
                }
                res.json({ success: true });
              }
            );
          }
        );
      }
    );
  }
);

router.get(
  "/prestamos/delete/:id",
  isAuthenticated,
  requireRole("bibliotecario"),
  function (req, res, next) {
    let id = req.params.id;
    dbConn.query(
      "SELECT libro FROM prestamos WHERE id = ?",
      [id],
      function (err, rows) {
        if (err || rows.length === 0) {
          req.flash("error", "Error al eliminar el préstamo");
          return res.redirect("/books/prestamos");
        }
        const libroId = rows[0].libro;
        dbConn.query(
          "DELETE FROM prestamos WHERE id = ?",
          [id],
          function (err2) {
            if (err2) {
              req.flash("error", "Error al eliminar el préstamo");
            } else {
              dbConn.query("UPDATE books SET prestado = 0 WHERE id = ?", [
                libroId,
              ]);
              req.flash("success", "Préstamo eliminado correctamente");
            }
            res.redirect("/books/prestamos");
          }
        );
      }
    );
  }
);

// ====================== AUTORES ======================
router.get("/autores", isAuthenticated, function (req, res, next) {
  dbConn.query("SELECT * FROM autores ORDER BY id DESC", function (err, rows) {
    if (err) {
      req.flash("error", "Error al obtener los autores");
      return res.render("books/autores", {
        autores: [],
        messages: req.flash(),
      });
    }
    res.render("books/autores", { autores: rows, messages: req.flash() });
  });
});

router.post(
  "/autores/add",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let nombre = req.body.nombre;
    if (!nombre) {
      return res.json({
        success: false,
        message: "Por favor, ingrese el nombre del autor.",
      });
    }
    dbConn.query(
      "INSERT INTO autores (nombre, estado) VALUES (?, 'Activo')",
      [nombre],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al registrar el autor.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/autores/edit/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let nombre = req.body.nombre;
    if (!nombre) {
      return res.json({
        success: false,
        message: "Por favor, ingrese el nombre del autor.",
      });
    }
    dbConn.query(
      "UPDATE autores SET nombre = ? WHERE id = ?",
      [nombre, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al editar el autor.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/autores/estado/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let { estado } = req.body;
    if (!estado) {
      return res.json({ success: false, message: "Estado no válido." });
    }
    dbConn.query(
      "UPDATE autores SET estado = ? WHERE id = ?",
      [estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al cambiar el estado del autor.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.get(
  "/autores/delete/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    dbConn.query("DELETE FROM autores WHERE id = ?", [id], function (err) {
      if (err) {
        req.flash("error", "Error al eliminar el autor");
      } else {
        req.flash("success", "Autor eliminado correctamente");
      }
      res.redirect("/books/autores");
    });
  }
);

// ====================== CATEGORÍAS ======================
router.get("/categorias", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT * FROM categorias ORDER BY id DESC",
    function (err, rows) {
      if (err) {
        req.flash("error", "Error al obtener las categorías");
        return res.render("books/categoria", {
          categorias: [],
          messages: req.flash(),
        });
      }
      res.render("books/categoria", {
        categorias: rows,
        messages: req.flash(),
      });
    }
  );
});

router.post(
  "/categorias/add",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let { nombre, estado } = req.body;
    if (!nombre || !estado) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    dbConn.query(
      "INSERT INTO categorias (nombre, estado) VALUES (?, ?)",
      [nombre, estado],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al registrar la categoría.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/categorias/edit/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let { nombre, estado } = req.body;
    if (!nombre || !estado) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    dbConn.query(
      "UPDATE categorias SET nombre = ?, estado = ? WHERE id = ?",
      [nombre, estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al editar la categoría.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/categorias/estado/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let { estado } = req.body;
    if (!estado) {
      return res.json({ success: false, message: "Estado no válido." });
    }
    dbConn.query(
      "UPDATE categorias SET estado = ? WHERE id = ?",
      [estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al cambiar el estado de la categoría.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.get(
  "/categorias/delete/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    dbConn.query("DELETE FROM categorias WHERE id = ?", [id], function (err) {
      if (err) {
        req.flash("error", "Error al eliminar la categoría");
      } else {
        req.flash("success", "Categoría eliminada correctamente");
      }
      res.redirect("/books/categorias");
    });
  }
);

// ====================== EDITORIALES ======================
router.get("/editoriales", isAuthenticated, function (req, res, next) {
  dbConn.query(
    "SELECT * FROM editoriales ORDER BY id DESC",
    function (err, rows) {
      if (err) {
        req.flash("error", "Error al obtener las editoriales");
        return res.render("books/editoriales", {
          editoriales: [],
          messages: req.flash(),
        });
      }
      res.render("books/editoriales", {
        editoriales: rows,
        messages: req.flash(),
      });
    }
  );
});

router.post(
  "/editoriales/add",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let { nombre, estado } = req.body;
    if (!nombre || !estado) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    dbConn.query(
      "INSERT INTO editoriales (nombre, estado) VALUES (?, ?)",
      [nombre, estado],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al registrar la editorial.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/editoriales/edit/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let { nombre, estado } = req.body;
    if (!nombre || !estado) {
      return res.json({
        success: false,
        message: "Por favor, complete todos los campos.",
      });
    }
    dbConn.query(
      "UPDATE editoriales SET nombre = ?, estado = ? WHERE id = ?",
      [nombre, estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al editar la editorial.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.post(
  "/editoriales/estado/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    let { estado } = req.body;
    if (!estado) {
      return res.json({ success: false, message: "Estado no válido." });
    }
    dbConn.query(
      "UPDATE editoriales SET estado = ? WHERE id = ?",
      [estado, id],
      function (err) {
        if (err) {
          return res.json({
            success: false,
            message: "Error al cambiar el estado de la editorial.",
          });
        }
        res.json({ success: true });
      }
    );
  }
);

router.get(
  "/editoriales/delete/:id",
  isAuthenticated,
  requireRole("admin"),
  function (req, res, next) {
    let id = req.params.id;
    dbConn.query("DELETE FROM editoriales WHERE id = ?", [id], function (err) {
      if (err) {
        req.flash("error", "Error al eliminar la editorial");
      } else {
        req.flash("success", "Editorial eliminada correctamente");
      }
      res.redirect("/books/editoriales");
    });
  }
);

// ====================== HOME ======================
router.get("/", function (req, res, next) {
  dbConn.query("SELECT * FROM books ORDER BY id DESC", function (err, rows) {
    if (err) {
      req.flash("error", "Error al obtener los libros");
      return res.render("books", { data: [], messages: req.flash() });
    }
    res.render("books", { data: rows, messages: req.flash() });
  });
});

module.exports = router;
