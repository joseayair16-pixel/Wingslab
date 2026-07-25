type RouteMetric = {
  method: string;
  route: string;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  lastStatusCode: number;
};

type InternalRouteMetric = {
  method: string;
  route: string;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  lastStatusCode: number;
};

const routeMetrics = new Map<string, InternalRouteMetric>();
const errorCodeCounts = new Map<string, number>();

let requestsTotal = 0;
let errorsTotal = 0;

function buildRouteKey(method: string, route: string): string {
  return `${method} ${route}`;
}

export function recordRequestMetric(params: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}) {
  requestsTotal += 1;

  const routeKey = buildRouteKey(params.method, params.route);
  const current = routeMetrics.get(routeKey) || {
    method: params.method,
    route: params.route,
    count: 0,
    errorCount: 0,
    totalDurationMs: 0,
    lastStatusCode: params.statusCode,
  };

  current.count += 1;
  current.totalDurationMs += params.durationMs;
  current.lastStatusCode = params.statusCode;

  if (params.statusCode >= 400) {
    current.errorCount += 1;
    errorsTotal += 1;
  }

  routeMetrics.set(routeKey, current);
}

export function recordErrorMetric(code: string) {
  errorCodeCounts.set(code, (errorCodeCounts.get(code) || 0) + 1);
}

export function getMetricsSnapshot(): {
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
  };
  routes: RouteMetric[];
  errorsByCode: Array<{ code: string; count: number }>;
} {
  const routes = Array.from(routeMetrics.values())
    .map((metric) => ({
      method: metric.method,
      route: metric.route,
      count: metric.count,
      errorCount: metric.errorCount,
      avgDurationMs: Number((metric.totalDurationMs / metric.count).toFixed(2)),
      lastStatusCode: metric.lastStatusCode,
    }))
    .sort((left, right) => right.count - left.count || left.route.localeCompare(right.route));

  const errorsByCode = Array.from(errorCodeCounts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  return {
    totals: {
      requests: requestsTotal,
      errors: errorsTotal,
      errorRate: requestsTotal > 0 ? Number(((errorsTotal / requestsTotal) * 100).toFixed(2)) : 0,
    },
    routes,
    errorsByCode,
  };
}

export function resetMetrics() {
  requestsTotal = 0;
  errorsTotal = 0;
  routeMetrics.clear();
  errorCodeCounts.clear();
}
