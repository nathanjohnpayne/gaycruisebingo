const FIRST_PARTY_AUTH_HOSTS = new Set([
  'gaycruisebingo.com',
  'gaycruisebingo.vercel.app',
  'gaycruisebingo.firebaseapp.com',
]);

/** Keep production OAuth helper storage on the same origin as the app. */
export function resolveAuthDomain(configuredAuthDomain: string, hostname: string): string {
  return FIRST_PARTY_AUTH_HOSTS.has(hostname) ? hostname : configuredAuthDomain;
}
