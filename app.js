/**
 * Universal Entry Point for cPanel / LiteSpeed Node.js (lsnode) / Phusion Passenger
 * Delegates to backend/app.js for monorepo compatibility
 */
import('./backend/app.js').catch((err) => {
  console.error('Failed to start application via backend/app.js:', err);
});
