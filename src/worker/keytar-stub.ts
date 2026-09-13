/**
 * Replaces the native keytar module inside the Workers bundle. The hosted server
 * only ever sees bearer tokens from the request context, so the keychain is
 * never reached; anything that gets here is a bug, and it fails loudly.
 */
const unavailable = (): never => {
  throw new Error("The OS keychain is not available in the hosted server.");
};

export default {
  getPassword: unavailable,
  setPassword: unavailable,
  deletePassword: unavailable,
};
