/**
 * Simple structured logger utility with timestamps and log levels.
 */

const formatTime = () => new Date().toISOString();

export const logger = {
  info: (msg, data = '') => {
    console.log(`[${formatTime()}] [INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warn: (msg, data = '') => {
    console.warn(`[${formatTime()}] [WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (msg, error = '') => {
    const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    console.error(`[${formatTime()}] [ERROR] ${msg}`, errorDetails ? JSON.stringify(errorDetails, null, 2) : '');
  },
  debug: (msg, data = '') => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${formatTime()}] [DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }
};
