export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (message = 'Not authorized') =>
  new ApiError(403, 'Unauthorized', message);

export const notFound = (message = 'Not found') =>
  new ApiError(404, 'NotFound', message);

export const badRequest = (message: string) =>
  new ApiError(400, 'BadRequest', message);
