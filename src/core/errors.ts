export type HttpErrorShape = {
  message: string;
  statusCode: number;
  details?: unknown;
};

export function toHttpError(err: unknown, fallbackStatusCode = 500): HttpErrorShape {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const message = typeof anyErr.message === 'string' ? anyErr.message : 'Unexpected error';
    const statusCode =
      typeof anyErr.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr.status === 'number'
        ? anyErr.status
        : fallbackStatusCode;

    const details = anyErr.details;
    return { message, statusCode, details };
  }
  return { message: 'Unexpected error', statusCode: fallbackStatusCode };
}
