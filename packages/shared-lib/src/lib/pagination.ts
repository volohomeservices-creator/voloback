/**
 * Extracts standard pagination parameters from a URL search params object.
 * Enforces a maximum page size to prevent memory exhaustion (PERF-001).
 *
 * @param searchParams The URLSearchParams from the request
 * @param defaultLimit Default number of items per page (default: 20)
 * @param maxLimit Maximum allowed items per page (default: 100)
 * @returns { page, limit, offset }
 */
export function getPaginationParams(
  searchParams: URLSearchParams,
  defaultLimit = 20,
  maxLimit = 100
) {
  let page = 1;
  let limit = defaultLimit;

  if (searchParams.has('page')) {
    const parsedPage = parseInt(searchParams.get('page') || '1', 10);
    if (!isNaN(parsedPage) && parsedPage > 0) {
      page = parsedPage;
    }
  }

  if (searchParams.has('limit')) {
    const parsedLimit = parseInt(searchParams.get('limit') || String(defaultLimit), 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, maxLimit);
    }
  }

  const offset = (page - 1) * limit;

  return { page, limit, offset };
}
