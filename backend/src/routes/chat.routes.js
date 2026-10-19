const express = require("express");
const { generateResponse } = require("../services/gemini.service");
const router = express.Router();
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REPLY_LENGTH = 6000;
const MAX_HISTORY_MESSAGES = 8; // Cuatro intercambios completos.

router.post("/", async (req, res) => {
    const { message, history = [] } = req.body || {};
    if (typeof message !== "string" || !message.trim()
        || message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            success: false,
            message: "Escribí un mensaje de entre 1 y 2000 caracteres."
        });
    }
    if (!Array.isArray(history) || history.length > MAX_HISTORY_MESSAGES
        || history.length % 2 !== 0
        || history.some((item, index) => !item
            || item.role !== (index % 2 === 0 ? "user" : "model")
            || typeof item.text !== "string" || !item.text.trim()
            || item.text.length > (index % 2 === 0 ? MAX_MESSAGE_LENGTH : MAX_REPLY_LENGTH))) {
        return res.status(400).json({
            success: false,
            message: "El historial de la conversación no es válido. Iniciá un nuevo chat."
        });
    }
    try {
        const response = await generateResponse(message.trim(), history);
        return res.json({ success: true, response });
    } catch (error) {
        // No registrar errores del proveedor: pueden incluir datos sensibles.
        const unavailable = error.code === "MISSING_API_KEY";
        return res.status(unavailable ? 503 : 502).json({
            success: false,
            message: unavailable
                ? "El asistente todavía no está configurado. Consultá al responsable de Ciclo Sur."
                : "No pudimos consultar al asistente. Intentá nuevamente en unos instantes."
        });
    }
});

module.exports = router;
