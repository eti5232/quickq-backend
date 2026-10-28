/**
 * שגיאה עסקית עם קוד HTTP, קוד שגיאה באנגלית והודעה בעברית.
 * ה-Error Handler הופך אותה לתשובה במבנה אחיד:
 * { "error": { "code": "...", "message": "...", "details": ... } }
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'נדרשת התחברות', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'אין לך הרשאה לבצע פעולה זו', code = 'FORBIDDEN') =>
  new AppError(403, code, message);

export const notFound = (message = 'הרשומה לא נמצאה', code = 'NOT_FOUND') =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
