import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.PROD ? 'production' : 'development',
    // No performance tracing — alerts only
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

// captureError — report a money-path or system failure to Sentry.
// context.company_id and context.operation become searchable tags.
// Do NOT call this for expected/validation failures the user triggered.
export function captureError(error, context = {}) {
  if (!DSN) return;
  Sentry.withScope(scope => {
    if (context.company_id) scope.setTag('company_id', String(context.company_id));
    if (context.operation)  scope.setTag('operation',  context.operation);
    // Extra context — no amounts or PII beyond what's needed to locate the issue
    Object.entries(context).forEach(([k, v]) => {
      if (k !== 'company_id' && k !== 'operation') scope.setExtra(k, v);
    });
    const err = error instanceof Error ? error : new Error(String(error?.message ?? error));
    Sentry.captureException(err);
  });
}

export { Sentry };
