import * as Sentry from '@sentry/node';

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0, sendDefaultPii: false });
  initialized = true;
}

// captureError — call in catch blocks for system failures.
// context.company_id and context.operation become searchable tags in Sentry.
export function captureError(error, context = {}) {
  ensureInit();
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope(scope => {
    if (context.company_id) scope.setTag('company_id', String(context.company_id));
    if (context.operation)  scope.setTag('operation',  context.operation);
    Object.entries(context).forEach(([k, v]) => {
      if (k !== 'company_id' && k !== 'operation') scope.setExtra(k, v);
    });
    const err = error instanceof Error ? error : new Error(String(error?.message ?? error));
    Sentry.captureException(err);
  });
}

// withSentry — wraps a Vercel handler so unhandled throws are captured
// before becoming a silent 500. Use as:
//   export default withSentry(async function handler(req, res) { ... })
export function withSentry(handler) {
  return async function wrappedHandler(req, res) {
    ensureInit();
    try {
      await handler(req, res);
    } catch (error) {
      captureError(error, { operation: handler.name || 'unknown-handler' });
      // Flush before Vercel freezes the function
      await Sentry.flush(2000).catch(() => {});
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  };
}
