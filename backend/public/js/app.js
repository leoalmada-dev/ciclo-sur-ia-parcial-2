const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const messagesContainer = document.getElementById("messages");
const newChatButton = document.getElementById("new-chat");
const sendButton = document.getElementById("send-button");
const welcomeMarkup = messagesContainer.innerHTML;
// Solo memoria de esta pestaña: no se guarda en cookies ni almacenamiento local.
let history = [];
let pendingRequest = null;
let chatVersion = 0;

function addMessage(text, sender) {
    messagesContainer.querySelector(".welcome")?.remove();
    const message = document.createElement("div");
    message.classList.add("message", sender);
    message.textContent = text;
    messagesContainer.appendChild(message);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setBusy(busy) {
    messageInput.disabled = busy;
    sendButton.disabled = busy;
    sendButton.textContent = busy ? "Consultando…" : "Enviar";
    chatForm.setAttribute("aria-busy", String(busy));
}

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (pendingRequest || !message) return;
    if (message.length > 2000) {
        addMessage("Escribí un mensaje de hasta 2000 caracteres.", "assistant");
        return;
    }
    const version = chatVersion;
    const controller = new AbortController();
    pendingRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    addMessage(message, "user");
    messageInput.value = "";
    setBusy(true);
    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, history }),
            signal: controller.signal
        });
        const data = await response.json();
        if (version !== chatVersion) return;
        if (!response.ok || !data.success) {
            const fallback = "No pudimos consultar al asistente. Intentá nuevamente.";
            // Solo mostrar mensajes previstos por nuestra API, nunca el cuerpo de un proxy.
            const messages = {
                400: "La consulta no es válida. Revisá el mensaje o iniciá un nuevo chat.",
                413: "El mensaje es demasiado grande.",
                503: "El asistente todavía no está configurado. Consultá al responsable de Ciclo Sur.",
                502: "No pudimos consultar al asistente. Intentá nuevamente en unos instantes."
            };
            addMessage(messages[response.status] || fallback, "assistant");
            return;
        }
        if (typeof data.response !== "string" || !data.response.trim()) {
            throw new Error("Respuesta inválida");
        }
        addMessage(data.response, "assistant");
        history = [...history,
            { role: "user", text: message },
            { role: "model", text: data.response.slice(0, 6000) }
        ].slice(-8);
    } catch (error) {
        if (version === chatVersion) {
            addMessage(error.name === "AbortError"
                ? "La consulta tardó demasiado. Intentá nuevamente."
                : "No se pudo conectar con el asistente. Intentá nuevamente.", "assistant");
        }
    } finally {
        clearTimeout(timeout);
        if (version === chatVersion) {
            pendingRequest = null;
            setBusy(false);
            messageInput.focus();
        }
    }
});

newChatButton.addEventListener("click", () => {
    chatVersion++;
    pendingRequest?.abort();
    pendingRequest = null;
    history = [];
    messagesContainer.innerHTML = welcomeMarkup;
    messageInput.value = "";
    setBusy(false);
    messageInput.focus();
});
