type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const NODE_ENV = process.env.NODE_ENV || 'development';

function structuredLog(level: LogLevel, message: string, meta?: unknown) {
  const entry: Record<string, unknown> = {
    level,
    timestamp: new Date().toISOString(),
    message,
    environment: NODE_ENV,
  };

  if (meta !== undefined) {
    if (meta instanceof Error) {
      entry.error = {
        name: meta.name,
        message: meta.message,
        stack: NODE_ENV === 'development' ? meta.stack : undefined,
      };
    } else if (typeof meta === 'object' && meta !== null) {
      Object.assign(entry, meta);
    } else {
      entry.data = meta;
    }
  }

  const line = JSON.stringify(entry);

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, data?: unknown) => {
    structuredLog('INFO', message, data);
  },
  error: (message: string, error?: unknown) => {
    structuredLog('ERROR', message, error);
  },
  warn: (message: string, data?: unknown) => {
    structuredLog('WARN', message, data);
  },
  debug: (message: string, data?: unknown) => {
    if (NODE_ENV === 'development') {
      structuredLog('DEBUG', message, data);
    }
  },
};
