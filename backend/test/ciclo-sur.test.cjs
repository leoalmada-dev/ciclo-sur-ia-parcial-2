const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

// Doble únicamente para tests: nunca se usa la red ni una clave de Gemini.
const calls = [];
let mode = 'success';
const answers = {
    '¿Qué horarios tienen?': 'Abrimos de lunes a viernes de 9 a 18 h, sábados de 9 a 13 h y domingos cerrado.',
    '¿Y los sábados?': 'Los sábados abrimos de 9 a 13 h.',
    '¿Qué servicios ofrecen?': 'Ajuste de frenos y cambios, cubiertas, cámaras y mantenimiento general.',
    'Mi bicicleta no frena bien': 'Si no frena bien, no circules. Traela para una revisión presencial.',
    '¿Cuánto cuesta ajustar los frenos?': 'No tengo precios confirmados. Consultalo con el taller durante su horario.'
};
class FakeGoogleGenAI {
    constructor() {
        this.models = {
            generateContent: async (options) => {
                calls.push(options);
                if (mode === 'error') throw new Error('SENSITIVE_PROVIDER_DETAIL');
                if (mode === 'empty') return { text: ' ' };
                const question = options.contents.at(-1).parts[0].text;
                return { text: answers[question] || 'Consultalo con Ciclo Sur durante su horario.' };
            }
        };
    }
}

function browser(base, overrides = {}) {
    const elements = new Map();
    class Element {
        constructor() {
            this.value = '';
            this.disabled = false;
            this.textContent = '';
            this.children = [];
            this.handlers = {};
            this.attributes = {};
            const classes = new Set();
            this.classList = {
                add(...names) { names.forEach(name => classes.add(name)); },
                contains(name) { return classes.has(name); }
            };
            this._html = '<div class="welcome">Ciclo Sur</div>';
        }
        set innerHTML(value) {
            this._html = value;
            this.children.forEach(child => { child.parentNode = null; });
            this.children = [];
        }
        get innerHTML() { return this._html; }
        querySelector() { return { remove() {} }; }
        querySelectorAll() { return this.buttons || []; }
        requestSubmit() { this.submitted = this.handlers.submit({ preventDefault() {} }); }
        appendChild(child) { child.parentNode = this; this.children.push(child); }
        remove() {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            siblings.splice(siblings.indexOf(this), 1);
            this.parentNode = null;
        }
        addEventListener(name, handler) { this.handlers[name] = handler; }
        setAttribute(name, value) { this.attributes[name] = value; }
        focus() { this.focusCount = (this.focusCount || 0) + 1; }
    }
    const requests = [];
    const env = {
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, new Element());
                return elements.get(id);
            },
            createElement() { return new Element(); }
        },
        AbortController,
        setTimeout: overrides.setTimeout || setTimeout,
        clearTimeout: overrides.clearTimeout || clearTimeout,
        fetch: async (url, options) => {
            requests.push(JSON.parse(options.body));
            if (overrides.fetch) return overrides.fetch(url, options);
            return fetch(base + url, options);
        }
    };
    const questions = [...fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
        .matchAll(/data-question="([^"]+)"/g)].map(match => match[1]);
    const quickButtons = questions.map(question => {
        const button = new Element();
        button.dataset = { question };
        return button;
    });
    env.document.getElementById('quick-questions').buttons = quickButtons;
    env.document.getElementById('chat-wait').hidden = true;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), env);
    return {
        env, requests, quickButtons,
        wait: elements.get('chat-wait'),
        async quick(index) {
            if (quickButtons[index].disabled) return;
            elements.get('quick-questions').handlers.click({
                target: { closest() { return quickButtons[index]; } }
            });
            await elements.get('chat-form').submitted;
        },
        input: elements.get('message-input'),
        messages: elements.get('messages'),
        send: elements.get('send-button'),
        newChat: elements.get('new-chat'),
        form: elements.get('chat-form'),
        async submit(text) {
            elements.get('message-input').value = text;
            await elements.get('chat-form').handlers.submit({ preventDefault() {} });
        },
        reset() { elements.get('new-chat').handlers.click(); }
    };
}

// Ejecuta el script real con DOM mínimo, fetch controlado y reloj manual.
// No usa la red ni espera los 35 segundos del timeout de producción.
function controlledBrowser({ ignoreAbort = false } = {}) {
    const pending = [];
    const timers = new Map();
    let timerId = 0;
    const ui = browser('', {
        fetch(url, options) {
            assert.equal(url, '/api/chat');
            assert.equal(options.method, 'POST');
            return new Promise((resolve, reject) => {
                pending.push({
                    signal: options.signal, reject,
                    respond(data = { success: true, response: 'Respuesta' }, status = 200) {
                        resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
                    },
                    resolve
                });
                if (!ignoreAbort) {
                    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
                }
            });
        },
        setTimeout(callback, delay) {
            assert.equal(delay, 35000);
            timers.set(++timerId, callback);
            return timerId;
        },
        clearTimeout(id) { timers.delete(id); }
    });
    return {
        ...ui, pending, timers,
        expire() { for (const callback of [...timers.values()]) callback(); },
        userMessages() { return ui.messages.children.filter(child => child.classList.contains('user')); }
    };
}

function assertBusy(ui, busy) {
    assert.equal(ui.input.disabled, busy);
    assert.equal(ui.send.disabled, busy);
    assert.equal(ui.send.textContent, busy ? 'Consultando…' : 'Enviar');
    assert.equal(ui.form.attributes['aria-busy'], String(busy));
    assert.equal(ui.wait.hidden, !busy);
    assert.ok(ui.quickButtons.every(button => button.disabled === busy));
    assert.equal(ui.newChat.disabled, false);
}

test('CICLO-SUR-UX-01: recuperación manual y aislamiento de conversaciones', async (t) => {
    await t.test('01 consulta exitosa conserva burbujas y limpia el campo', async () => {
        const ui = controlledBrowser();
        const sent = ui.submit('  Horarios  ');
        assert.equal(ui.input.value, '');
        assert.deepEqual(ui.requests, [{ message: 'Horarios', history: [] }]);
        ui.pending[0].respond();
        await sent;
        assert.deepEqual(ui.messages.children.map(child => child.textContent), ['Horarios', 'Respuesta']);
        assert.equal(ui.input.value, '');
        assert.equal(ui.timers.size, 0);
        assertBusy(ui, false);
    });

    const failures = [
        ['02 HTTP no exitoso', request => request.respond({ success: false }, 502)],
        ['03 error de conexión', request => request.reject(new TypeError('PRIVATE_NETWORK_DETAIL'))],
        ['04 timeout', (_request, ui) => ui.expire()],
        ['05 JSON malformado', request => request.resolve({ ok: true, json: async () => {
            throw new SyntaxError('PRIVATE_JSON_DETAIL');
        } })]
    ];
    for (const [name, fail] of failures) {
        await t.test(name + ': restaura texto exacto sin reintentar', async () => {
            const ui = controlledBrowser();
            const original = '  Necesito revisar mis frenos  ';
            const sent = ui.submit(original);
            assertBusy(ui, true);
            fail(ui.pending[0], ui);
            await sent;
            assert.equal(ui.input.value, original);
            assert.equal(ui.userMessages().length, 0);
            assert.equal(ui.messages.children.length, 1);
            assert.doesNotMatch(ui.messages.children[0].textContent, /PRIVATE/);
            assertBusy(ui, false);
            assert.equal(ui.input.focusCount, 1);
            assert.equal(ui.requests.length, 1);
            assert.equal(ui.timers.size, 0);
            if (name.startsWith('04')) {
                assert.equal(ui.pending[0].signal.aborted, true);
                assert.match(ui.messages.children[0].textContent, /tardó demasiado/);
            }
        });
    }

    await t.test('06 respuestas estructuralmente inválidas recuperan el mensaje', async () => {
        for (const body of [null, {}, [], 'texto', { success: false },
            { success: 'true', response: 'No válida' }, { success: 1, response: 'No válida' },
            { success: true }, { success: true, response: null },
            { success: true, response: 42 }, { success: true, response: '  ' }]) {
            const ui = controlledBrowser();
            const sent = ui.submit('Mi consulta');
            ui.pending[0].respond(body);
            await sent;
            assert.equal(ui.input.value, 'Mi consulta');
            assert.equal(ui.userMessages().length, 0);
            assertBusy(ui, false);
        }
    });

    await t.test('07 texto recuperado editable; 08 reenvío manual sin burbuja duplicada', async () => {
        const ui = controlledBrowser();
        const first = ui.submit('Frenos');
        ui.pending[0].respond({ success: false }, 503);
        await first;
        assert.equal(ui.input.value, 'Frenos');
        const retry = ui.submit(ui.input.value + ' y cambios');
        assert.equal(ui.userMessages().length, 1);
        assert.equal(ui.userMessages()[0].textContent, 'Frenos y cambios');
        ui.pending[1].respond();
        await retry;
        assert.equal(ui.userMessages().length, 1);
        assert.equal(ui.requests.length, 2);
    });

    await t.test('09 historial excluye todos los fallos; 10 conserva intercambios exitosos', async () => {
        const ui = controlledBrowser();
        const first = ui.submit('Primera');
        ui.pending[0].respond({ success: true, response: 'Primera respuesta' });
        await first;
        const expected = [{ role: 'user', text: 'Primera' }, { role: 'model', text: 'Primera respuesta' }];
        for (const [, fail] of [...failures, ['inválida', request => request.respond(null)]]) {
            const sent = ui.submit('Consulta fallida');
            fail(ui.pending.at(-1), ui);
            await sent;
            assert.deepEqual(ui.requests.at(-1).history, expected);
            assert.deepEqual(ui.userMessages().map(child => child.textContent), ['Primera']);
        }
        const retry = ui.submit('Reintento');
        assert.deepEqual(ui.requests.at(-1).history, expected);
        ui.pending.at(-1).respond({ success: true, response: 'Segunda respuesta' });
        await retry;
        const next = ui.submit('Siguiente');
        assert.deepEqual(ui.requests.at(-1).history, [...expected,
            { role: 'user', text: 'Reintento' }, { role: 'model', text: 'Segunda respuesta' }]);
        ui.pending.at(-1).respond();
        await next;
    });

    await t.test('11 Nuevo chat cancela, vacía campo, historial y conversación sin restaurar', async () => {
        const ui = controlledBrowser();
        const first = ui.submit('Conservar hasta reset');
        ui.pending[0].respond();
        await first;
        const pending = ui.submit('Descartar');
        ui.reset();
        assert.equal(ui.pending[1].signal.aborted, true);
        await pending;
        assert.equal(ui.input.value, '');
        assert.equal(ui.messages.children.length, 0);
        assert.match(ui.messages.innerHTML, /welcome/);
        assertBusy(ui, false);
        assert.equal(ui.timers.size, 0);
        const next = ui.submit('Nueva');
        assert.deepEqual(ui.requests.at(-1).history, []);
        ui.pending[2].respond();
        await next;
    });

    await t.test('12 respuestas y errores tardíos no alteran borradores ni solicitudes nuevas', async () => {
        for (const late of [request => request.respond(), request => request.reject(new Error('late')),
            request => request.respond(null), request => request.respond({ success: false }, 502)]) {
            const ui = controlledBrowser({ ignoreAbort: true });
            const old = ui.submit('Anterior');
            ui.reset();
            ui.input.value = 'Borrador nuevo';
            late(ui.pending[0]);
            await old;
            assert.equal(ui.input.value, 'Borrador nuevo');
            assert.equal(ui.messages.children.length, 0);

            const older = ui.submit('Otra anterior');
            ui.reset();
            const current = ui.submit('Actual');
            const focusCount = ui.input.focusCount;
            late(ui.pending[1]);
            await older;
            assertBusy(ui, true);
            assert.equal(ui.input.focusCount, focusCount);
            assert.equal(ui.timers.size, 1);
            assert.deepEqual(ui.userMessages().map(child => child.textContent), ['Actual']);
            assert.equal(ui.input.value, '');
            assert.deepEqual(ui.requests.at(-1).history, []);
            ui.pending[2].respond({ success: true, response: 'Actual respuesta' });
            await current;
            const next = ui.submit('Siguiente');
            assert.deepEqual(ui.requests.at(-1).history, [
                { role: 'user', text: 'Actual' }, { role: 'model', text: 'Actual respuesta' }]);
            ui.pending[3].respond();
            await next;
        }
    });

    await t.test('12b timeout descarta éxito tardío aunque fetch ignore abort', async () => {
        const ui = controlledBrowser({ ignoreAbort: true });
        const sent = ui.submit('Expirada');
        ui.expire();
        ui.pending[0].respond();
        await sent;
        assert.equal(ui.input.value, 'Expirada');
        assert.equal(ui.userMessages().length, 0);
        assert.match(ui.messages.children.at(-1).textContent, /tardó demasiado/);
    });

    await t.test('13 consultas rápidas tras un error usan el formulario y el mismo flujo', async () => {
        const ui = controlledBrowser();
        const first = ui.submit('Fallida');
        ui.pending[0].respond({ success: false }, 502);
        await first;
        const quick = ui.quick(0);
        assertBusy(ui, true);
        assert.equal(ui.requests[1].message, ui.quickButtons[0].dataset.question);
        assert.deepEqual(ui.requests[1].history, []);
        assert.equal(ui.userMessages().length, 1);
        ui.pending[1].respond();
        await quick;
        assertBusy(ui, false);
    });

    await t.test('14 espera, accesibilidad y bloqueo de envíos simultáneos', async () => {
        const ui = controlledBrowser();
        const sent = ui.submit('Pendiente');
        assertBusy(ui, true);
        await ui.submit('No enviar');
        await ui.quick(0);
        assert.equal(ui.requests.length, 1);
        ui.pending[0].respond();
        await sent;
        assertBusy(ui, false);
        assert.equal(ui.input.focusCount, 1);
    });
});

test('Ciclo Sur: frontend, API y contrato Gemini simulado', async (t) => {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    const load = Module._load;
    let app;
    try {
        Module._load = function (name, ...args) {
            if (name === '@google/genai') return { GoogleGenAI: FakeGoogleGenAI };
            // No cargar un .env real si el usuario configura uno después.
            if (name === 'dotenv') return { config() {} };
            return load.call(this, name, ...args);
        };
        app = require('../src/app');
    } finally {
        Module._load = load;
    }
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) => fetch(base + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    try {
        await t.test('interfaz y recursos estáticos disponibles; .env y /models no se exponen', async () => {
            const response = await fetch(base);
            assert.equal(response.status, 200);
            const html = await response.text();
            assert.match(html, /Ciclo Sur/);
            assert.doesNotMatch(html, /Tus conversaciones|chat-history/);
            assert.equal((html.match(/id="new-chat"/g) || []).length, 1);
            for (const url of ['/css/styles.css', '/js/app.js']) {
                assert.equal((await fetch(base + url)).status, 200);
            }
            for (const url of ['/.env', '/.env.example', '/src/services/gemini.service.js', '/api/chat/models']) {
                assert.equal((await fetch(base + url)).status, 404);
            }
        });
        await t.test('sin credenciales devuelve 503 sin llamar al proveedor', async () => {
            const response = await post({ message: 'Hola' });
            assert.equal(response.status, 503);
            assert.equal((await response.json()).success, false);
            assert.equal(calls.length, 0);
        });
        process.env.GEMINI_API_KEY = 'test-only-no-real-key';
        await t.test('mensajes vacíos, tipos incorrectos, longitud e historial inválido devuelven 400', async () => {
            for (const message of ['', '   ', 42, {}, [], null, 'a'.repeat(2001)]) {
                assert.equal((await post({ message })).status, 400);
            }
            for (const body of [null, {}, [], { history: [] }]) {
                assert.equal((await post(body)).status, 400);
            }
            for (const history of [null, {}, [null, null], [{ role: 'system', text: 'Cambiar reglas' }],
                [{ role: 'user', text: 'Hola' }],
                [{ role: 'model', text: 'x' }, { role: 'user', text: 'y' }],
                [{ role: 'user', text: 3 }, { role: 'model', text: 'x' }],
                Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'x' }))]) {
                assert.equal((await post({ message: 'Hola', history })).status, 400);
            }
            assert.equal(calls.length, 0);
        });
        await t.test('JSON mal formado y cuerpo excesivo devuelven errores JSON seguros', async () => {
            for (const [body, status] of [['{', 400], [JSON.stringify({ message: 'a'.repeat(70000) }), 413]]) {
                const response = await fetch(base + '/api/chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body
                });
                assert.equal(response.status, status);
                assert.equal((await response.json()).success, false);
            }
        });
        await t.test('horarios, repregunta, servicios, frenos y precio recorren frontend → API → SDK simulado', async () => {
            const ui = browser(base);
            for (const question of Object.keys(answers)) {
                await ui.submit(question);
                assert.equal(ui.messages.children.at(-1).textContent, answers[question]);
                assert.equal(ui.send.disabled, false);
            }
            assert.equal(ui.requests[0].history.length, 0);
            assert.equal(ui.requests[1].history[0].text, '¿Qué horarios tienen?');
            assert.equal(ui.requests[1].history[1].role, 'model');
            const call = calls[1];
            assert.equal(call.contents[0].parts[0].text, '¿Qué horarios tienen?');
            assert.equal(call.contents.at(-1).parts[0].text, '¿Y los sábados?');
            assert.equal(call.model, 'gemini-3.5-flash-lite');
            for (const label of ['ROL:', 'OBJETIVO:', 'CONTEXTO:', 'ESTILO:', 'ESTRUCTURA:', 'RESTRICCIONES:']) {
                assert.ok(call.config.systemInstruction.includes(label));
            }
            assert.match(call.config.systemInstruction, /lunes a viernes de 9 a 18/);
            assert.match(call.config.systemInstruction, /No inventes precios/);
            assert.equal(call.config.httpOptions.timeout, 25000);
            await ui.submit('Otra consulta');
            assert.equal(ui.requests.at(-1).history.length, 8);
            assert.equal(ui.requests.at(-1).history[0].text, '¿Y los sábados?');
            ui.reset();
            assert.equal(ui.messages.children.length, 0);
            await ui.submit('Hola');
            assert.deepEqual(ui.requests.at(-1).history, []);
            const reloaded = browser(base);
            await reloaded.submit('Hola');
            assert.deepEqual(reloaded.requests[0].history, []);
        });
        await t.test('cuatro consultas rápidas usan el único envío y conservan historial', async () => {
            const ui = browser(base);
            assert.equal(ui.quickButtons.length, 4);
            const start = calls.length;
            for (let i = 0; i < 4; i++) {
                await ui.quick(i);
                assert.equal(ui.requests.length, i + 1);
                assert.equal(ui.requests[i].message, ui.quickButtons[i].dataset.question);
                assert.equal(ui.requests[i].history.length, i * 2);
                assert.equal(ui.wait.hidden, true);
                assert.ok(ui.quickButtons.every(button => !button.disabled));
            }
            assert.equal(calls.length - start, 4);
            ui.reset();
            await ui.quick(0);
            assert.deepEqual(ui.requests.at(-1).history, []);
        });
        await t.test('error y respuesta vacía del proveedor: 502, sin detalles sensibles ni historial de error', async () => {
            for (const failure of ['error', 'empty']) {
                mode = failure;
                const response = await post({ message: 'Hola' });
                assert.equal(response.status, 502);
                const body = await response.text();
                assert.doesNotMatch(body, /SENSITIVE_PROVIDER_DETAIL|test-only-no-real-key/);
                const ui = browser(base);
                await ui.submit('Hola');
                assert.match(ui.messages.children.at(-1).textContent, /Intentá nuevamente/);
                assert.equal(ui.send.disabled, false);
                mode = 'success';
                await ui.submit('Hola otra vez');
                assert.deepEqual(ui.requests.at(-1).history, []);
            }
        });
        await t.test('bloquea envíos simultáneos y descarta respuesta antigua tras Nuevo chat', async () => {
            const ui = browser(base);
            let release;
            ui.env.fetch = () => new Promise(resolve => { release = resolve; });
            const first = ui.submit('Primera consulta');
            assert.equal(ui.send.disabled, true);
            assert.equal(ui.wait.hidden, false);
            assert.ok(ui.quickButtons.every(button => button.disabled));
            await ui.quick(0);
            await ui.submit('No debe enviarse');
            ui.reset();
            assert.equal(ui.send.disabled, false);
            assert.equal(ui.wait.hidden, true);
            release({ ok: true, json: async () => ({ success: true, response: 'Respuesta antigua' }) });
            await first;
            assert.equal(ui.messages.children.length, 0);
            ui.env.fetch = async (url, options) => {
                assert.deepEqual(JSON.parse(options.body).history, []);
                return { ok: true, json: async () => ({ success: true, response: 'Nuevo contexto' }) };
            };
            await ui.submit('Nueva consulta');
            assert.equal(ui.messages.children.at(-1).textContent, 'Nuevo contexto');
        });
        await t.test('error de red y respuesta no JSON recuperan controles y muestran texto seguro', async () => {
            const ui = browser(base);
            for (const fail of [async () => { throw new Error('SENSITIVE_PROVIDER_DETAIL'); },
                async () => ({ json: async () => { throw new SyntaxError('SENSITIVE_PROVIDER_DETAIL'); } })]) {
                ui.env.fetch = fail;
                await ui.submit('Hola');
                assert.equal(ui.send.disabled, false);
                assert.match(ui.messages.children.at(-1).textContent, /No se pudo conectar/);
                assert.doesNotMatch(ui.messages.children.at(-1).textContent, /SENSITIVE_PROVIDER_DETAIL/);
            }
        });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = oldKey;
        if (oldModel === undefined) delete process.env.GEMINI_MODEL;
        else process.env.GEMINI_MODEL = oldModel;
    }
});
