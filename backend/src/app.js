const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const express = require("express");
const chatRoutes = require("./routes/chat.routes");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use("/api/chat", chatRoutes);
// Local: Express sirve la interfaz. Vercel sirve public/ desde su CDN.
app.use(express.static(path.join(__dirname, "../public")));
app.use((req, res) => {
    res.status(404).json({ success: false, message: "Ruta no encontrada." });
});
app.use((error, req, res, next) => {
    const status = error.type === "entity.too.large" ? 413
        : error.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({
        success: false,
        message: status === 413 ? "El mensaje es demasiado grande."
            : status === 400 ? "El cuerpo de la solicitud debe ser JSON válido."
            : "No se pudo procesar la solicitud."
    });
});

if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Ciclo Sur: http://localhost:${port}`));
}

module.exports = app;
