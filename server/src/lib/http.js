// Shared HTTP helpers: typed errors, async wrapper, strict body validation.

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message) => new HttpError(409, 'conflict', message);

// Express 4 does not forward rejected promises; this wrapper does.
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Body is parsed by zod; unknown keys are rejected by the schemas themselves.
export const parseBody = (schema, body) => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Request body failed validation', result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })));
  }
  return result.data;
};

export const parseQuery = (schema, query) => {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw badRequest('Query failed validation');
  }
  return result.data;
};
