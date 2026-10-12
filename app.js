/**
 * Universal Entry Point for cPanel / LiteSpeed Node.js (lsnode) / Phusion Passenger
 * Supports CommonJS launcher requiring ES Module index.js
 */
import('./src/index.js').catch((err) => {
  console.error('Failed to start application via app.js:', err);
});
