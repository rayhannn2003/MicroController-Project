/** An error that is safe to show to API clients: its code and message are sent as-is. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}
