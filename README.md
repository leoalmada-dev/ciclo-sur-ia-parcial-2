# Ciclo Sur — Parcial 2 de Inteligencia Artificial

Ciclo Sur es un taller ficticio de bicicletas. Sus clientes repiten consultas
sobre horarios, servicios y mantenimiento; responderlas manualmente ocupa tiempo.
El asistente usa Gemini para interpretar consultas en lenguaje natural y responder
de forma breve usando los datos y límites indicados en el prompt del sistema.

Parte del código y del diseño deriva del ejemplo docente proporcionado por la
profesora. Se conservaron HTML, CSS, JavaScript, Express y la integración Gemini;
se adaptaron la identidad, el prompt, el contexto breve y la publicación.

## Alcance

- Horario: lunes a viernes 9–18 h; sábados 9–13 h; domingos cerrado.
- Servicios: ajuste de frenos y cambios, cubiertas, cámaras y mantenimiento general.
- No se conocen precios, plazos, disponibilidad, stock, dirección ni contactos.
  El asistente debe reconocer esos límites y no confirmar reservas.
- Conserva cuatro intercambios previos en memoria de la pestaña. “Nuevo chat” y
  recargar la página borran el contexto. Los errores no se incorporan al historial.
- No hay base de datos, autenticación, RAG ni herramientas externas.
  Cada consulta se envía a Gemini con el contexto reciente; evitá datos sensibles.
- Las restricciones del prompt orientan al LLM, pero no garantizan cada respuesta.

## Tecnologías y estructura

Node.js 22, Express 5, SDK oficial `@google/genai`, dotenv; Nodemon para desarrollo.
No se agregaron dependencias. La dependencia CORS del ejemplo queda en el lockfile,
pero no se utiliza: interfaz y API comparten origen.

- `backend/public/`: frontend trasladado desde `frontend/`, manteniendo el diseño.
- `backend/src/app.js`: Express, frontend local y errores JSON.
- `backend/src/routes/chat.routes.js`: POST `/api/chat` y validación.
- `backend/src/services/gemini.service.js`: modelo, prompt y llamada a Gemini.
- `backend/test/`: pruebas locales con SDK simulado, sin llamadas a Gemini.

## Ejecución local

Desde la carpeta de esta copia:

```bash
cd backend
npm ci
cp .env.example .env
# Editar .env localmente y completar GEMINI_API_KEY.
npm run dev
```

Abrir `http://localhost:3000`. Para ejecución sin Nodemon usar `npm start`.
No abrir el HTML por separado. `PORT` permite elegir otro puerto.
La clave se lee solo en el backend; nunca se entrega al navegador.
Sin clave, la interfaz abre y la API devuelve 503 con un mensaje seguro.
`GEMINI_MODEL` es opcional; por defecto se usa `gemini-3.5-flash-lite`.

## Pruebas

```bash
cd backend
npm test
```

Las pruebas usan un doble de Gemini, no credenciales reales: verifican validación,
historial, errores y el contrato de integración; no evalúan la calidad del LLM.
Para la prueba real posterior: preguntar horarios y “¿y los sábados?”, servicios,
“Mi bicicleta no frena bien” y “¿Cuánto cuesta ajustar los frenos?”. Verificar
horarios correctos, revisión presencial, no circular si no frena bien y ausencia
de precios inventados. Luego iniciar “Nuevo chat” y comprobar que no recuerda.

## GitHub y Vercel (todavía no publicados)

1. Revisar la copia y excluir `.env`, `node_modules/` y `.vercel/`.
2. Crear el repositorio de GitHub cuando se autorice, conservando este README,
   fuentes, pruebas, `.env.example` y `package-lock.json`.
3. Importarlo en un único proyecto de Vercel, con Root Directory `backend`,
   framework Express y Node.js 22.x. No se necesita un build de frontend ni
   una configuración legacy de `builds`/rewrites. Mantener ajustes automáticos.
4. Configurar `GEMINI_API_KEY` en las variables de entorno del proyecto para
   Preview/Production según se use. Configurar también
   `GEMINI_MODEL=gemini-3.5-flash-lite`, el modelo validado para esta entrega.
   No subir `.env`.
5. Validar la URL de preview: interfaz, archivos estáticos y POST `/api/chat`.
   Vercel detecta `src/app.js` exportado y sirve `public/` desde su CDN.

Referencia: https://vercel.com/docs/frameworks/backend/express

## Pendientes y límites

El equipo informó una validación real satisfactoria con `gemini-3.5-flash-lite`,
incluyendo continuidad conversacional, horarios, servicios y límites sobre precios.
Las pruebas automatizadas siguen usando Gemini simulado, sin consumir cuota.
El acceso al modelo y las cuotas del entorno de Vercel deben verificarse allí.
El despliegue requiere comprobar tiempos de respuesta y configuración en Vercel.
El cliente puede modificar el historial; no debe tratarse como evidencia de datos
reales ni reservas.

### Uso público y cuota para la demo

- La API no tiene autenticación ni control de frecuencia. Cualquier persona puede
  llamar directamente a `/api/chat`, aunque el botón del navegador esté bloqueado.
- Se conservan los límites existentes: mensajes de 2000 caracteres, cuatro
  intercambios de contexto, cuerpo JSON de 64 KB, salida de 1000 tokens y timeout
  del proveedor de 25 segundos. Reducen cada solicitud; no limitan el total de uso.
- Usar una clave destinada a la demo, restringida a la API de Gemini cuando sea
  aplicable. Guardarla solo en backend y en las variables de entorno de Vercel.
- Antes y durante la exposición, revisar uso y límites activos en Google AI Studio.
  Las cuotas se comparten por proyecto, no por clave; una clave adicional en el
  mismo proyecto no crea una cuota independiente.
- Compartir la URL con el grupo necesario y mantener la demo disponible durante
  un período acotado. No divulgar el enlace no constituye un control de acceso.
  Al terminar, deshabilitar el acceso a Gemini (por ejemplo, revocar la clave de
  demo). Ante abuso, detenerla; no hacen falta nuevos servicios para esta entrega.
- Si se requiere dejarla abierta por más tiempo, evaluar límites en el firewall
  de Vercel según las opciones del plan. No se implementaron servicios adicionales.

Referencias:
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/api-key
