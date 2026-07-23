import { z } from 'zod';
import { NextResponse } from 'next/server';

/**
 * Common regex patterns
 */
export const PHONE_REGEX = /^\+91\d{10}$/;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Standard HTTP 400 response for validation errors
 */
export function validationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    { 
      success: false, 
      error: 'Validation failed', 
      details: error.flatten().fieldErrors 
    },
    { status: 400 }
  );
}

type ValidationResult<T> = 
  | { success: true; data: T; errorResponse: null }
  | { success: false; data: null; errorResponse: NextResponse };

/**
 * Validates a request body against a Zod schema.
 * Returns the parsed data or an HTTP 400 response.
 */
export async function validateBody<T>(
  request: Request,
  schema: z.Schema<T>
): Promise<ValidationResult<T>> {
  try {
    const rawBody = await request.json();
    const result = schema.safeParse(rawBody);

    if (!result.success) {
      return { success: false, data: null, errorResponse: validationErrorResponse(result.error) };
    }

    return { success: true, data: result.data, errorResponse: null };
  } catch (err) {
    return { 
      success: false,
      data: null, 
      errorResponse: NextResponse.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 }) 
    };
  }
}

/**
 * Validates search params from a NextRequest URL against a Zod schema.
 */
export function validateQuery<T>(
  searchParams: URLSearchParams,
  schema: z.Schema<T>
): { data: T | null; errorResponse: NextResponse | null } {
  const queryObj = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(queryObj);
  
  if (!result.success) {
    return { data: null, errorResponse: validationErrorResponse(result.error) };
  }

  return { data: result.data, errorResponse: null };
}
