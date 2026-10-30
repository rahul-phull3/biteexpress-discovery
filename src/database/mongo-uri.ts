/**
 * Hides the user name and password in a MongoDB connection string so it can
 * be written to a log or an error message. Anything after the credentials
 * (host, database, options) is kept because it is what you need to debug.
 */
export function redactMongoUri(uri: string): string {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^/@]*@/, '$1***@');
}
