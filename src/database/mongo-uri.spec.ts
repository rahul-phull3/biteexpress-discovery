import { redactMongoUri } from './mongo-uri';

describe('redactMongoUri', () => {
  it('hides the user name and password but keeps the rest', () => {
    expect(
      redactMongoUri(
        'mongodb://app:s3cret@db.example.com:27017/biteexpress?authSource=admin',
      ),
    ).toBe('mongodb://***@db.example.com:27017/biteexpress?authSource=admin');
  });

  it('works for mongodb+srv connection strings', () => {
    expect(
      redactMongoUri('mongodb+srv://app:s3cret@cluster0.example.mongodb.net/'),
    ).toBe('mongodb+srv://***@cluster0.example.mongodb.net/');
  });

  it('leaves a connection string without credentials as it is', () => {
    const uri = 'mongodb://127.0.0.1:27017/?directConnection=true';
    expect(redactMongoUri(uri)).toBe(uri);
  });

  it('does not mistake an @ in the options for credentials', () => {
    const uri = 'mongodb://127.0.0.1:27017/?appName=a@b';
    expect(redactMongoUri(uri)).toBe(uri);
  });
});
