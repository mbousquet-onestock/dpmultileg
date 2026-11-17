import request from 'supertest';
import { describe, expect, it } from 'vitest';

// Default deployment: no signature verification, no ADMIN_TOKEN.
process.env.MOCK_ONESTOCK = 'true';
process.env.DB_PATH = ':memory:';
process.env.CREDENTIALS_KEY = 'd'.repeat(64);
process.env.JWT_SECRET = 'test-secret-2';
delete process.env.VERIFY_SIGNATURE;
delete process.env.ADMIN_TOKEN;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { createApp } = await import('./app.js');
const app = createApp();

describe('without signature nor admin token', () => {
  it('configures credentials and opens a session from the OneStock context only', async () => {
    await request(app).put('/api/admin/credentials/p0038/qualif').send({ user_id: 'p0038_api', password: 'pwd', api_url: 'https://api.eu1.qualif.onestock-retail.com/' }).expect(200);
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({ verify_signature: false, admin_protected: false });
    const res = await request(app)
      .post('/api/session')
      .send({ site_id: 'p0038', user_id: 'u1', api_url: 'https://api.eu1.qualif.onestock-retail.com', extension_signature: 'garbage' })
      .expect(200);
    expect(res.body).toMatchObject({ site_id: 'p0038', environment: 'qualif', signed: false });
  });
});
