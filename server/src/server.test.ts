import { createHmac } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.MOCK_ONESTOCK = 'true';
process.env.ALLOW_UNSIGNED = 'false';
process.env.VERIFY_SIGNATURE = 'true';
process.env.DB_PATH = ':memory:';
process.env.CREDENTIALS_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_TOKEN = 'admin';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { createApp } = await import('./app.js');
const { decrypt, encrypt } = await import('./crypto.js');
const { verifyExtensionSignature } = await import('./signature.js');
const { environmentFromApiUrl, getCredential, resolveApiUrl } = await import('./credentials.js');
const { simplifyItem } = await import('./routes.js');

const app = createApp();
const SECRET = 'ext-secret';
const sign = (t: number, ext = 'ext1', user = 'u1', key = SECRET) => createHmac('sha256', key).update(`${t}.${ext}##${user}`).digest('hex');

describe('signature', () => {
  const now = 1_757_000_000;
  it('accepts any of h0/h1/h2 with any key', () => {
    const sig = `t=${now},h0=${sign(now, 'ext1', 'u1', 'new')},h1=${sign(now)},h2=x`;
    expect(verifyExtensionSignature({ extension_signature: sig, extension_id: 'ext1', user_id: 'u1' }, [SECRET], 3600, now)).toBe(true);
  });
  it('rejects tampering and old signatures', () => {
    const sig = `t=${now},h0=${sign(now)}`;
    expect(verifyExtensionSignature({ extension_signature: sig, extension_id: 'ext1', user_id: 'u2' }, [SECRET], 3600, now)).toBe(false);
    expect(verifyExtensionSignature({ extension_signature: sig, extension_id: 'ext1', user_id: 'u1' }, [SECRET], 3600, now + 7200)).toBe(false);
  });
});

describe('credentials', () => {
  it('encrypts at rest', () => {
    const enc = encrypt('p@ss');
    expect(enc).not.toContain('p@ss');
    expect(decrypt(enc)).toBe('p@ss');
  });
  it('derives environment and api url', () => {
    expect(environmentFromApiUrl('https://c00.api.qualif.onestock-retail.com')).toBe('qualif');
    expect(environmentFromApiUrl('https://api-client.eu1.prod.onestock-retail.com')).toBe('prod');
  });
});

describe('API', () => {
  let token = '';
  beforeAll(async () => {
    await request(app)
      .put('/api/admin/credentials/c00/qualif')
      .set('Authorization', 'Bearer admin')
      .send({ user_id: 'api_user', password: 'Pa55-w0rd', extension_secrets: [SECRET] })
      .expect(200);
  });

  it('protects admin routes and never returns passwords', async () => {
    await request(app).get('/api/admin/credentials').expect(401);
    const res = await request(app).get('/api/admin/credentials').set('Authorization', 'Bearer admin').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Pa55-w0rd');
    expect(res.body.credentials[0]).toMatchObject({ site_id: 'c00', environment: 'qualif', has_extension_secrets: true });
    const cred = (await getCredential('c00', 'qualif'))!;
    expect(cred.password).toBe('Pa55-w0rd');
    expect(resolveApiUrl(cred, 'https://evil.example.com')).toBe('https://c00.api.qualif.onestock-retail.com');
  });

  it('rejects invalid signatures', async () => {
    const t = Math.floor(Date.now() / 1000);
    await request(app)
      .post('/api/session')
      .send({ site_id: 'c00', user_id: 'u1', extension_id: 'ext1', api_url: 'https://c00.api.qualif.onestock-retail.com', extension_signature: `t=${t},h0=bad` })
      .expect(403);
  });

  it('opens a session from a signed handshake', async () => {
    const t = Math.floor(Date.now() / 1000);
    const res = await request(app)
      .post('/api/session')
      .send({ site_id: 'c00', user_id: 'u1', extension_id: 'ext1', api_url: 'https://c00.api.qualif.onestock-retail.com', extension_signature: `t=${t},h0=${sign(t)}` })
      .expect(200);
    expect(res.body).toMatchObject({ environment: 'qualif', signed: true });
    token = res.body.token;
  });

  it('requires a session for OneStock data', async () => {
    await request(app).get('/api/referential').expect(401);
    const ref = await request(app).get('/api/referential').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ref.body.delivery_routes.length).toBeGreaterThan(5);
    expect(ref.body.endpoints.length).toBeGreaterThan(3);
  });

  it('computes a multi-leg delivery promise', async () => {
    const res = await request(app)
      .post('/api/delivery_promises')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sales_channel: 'ecom_fr',
        line_items: [{ item_id: 'PARKA_WINTER_KK_M', qty: 1 }],
        delivery_options: [{ delivery_method: 'SDD', destination: { location: { country: 'FR', zip_code: '75011' } } }],
      })
      .expect(200);
    const option = res.body.response.delivery_options[0];
    expect(option.status).toBe('valid');
    expect(option.delivery_routes.map((r: { id: string }) => r.id)).toEqual(['r_wh_hub_paris', 'r_hub_idf_sdd']);
    expect(res.body.request.fields).toContain('delivery_options.delivery_routes');
  });

  it('keeps the stored password when it is not re-entered', async () => {
    await request(app)
      .put('/api/admin/credentials/c00/qualif')
      .set('Authorization', 'Bearer admin')
      .send({ user_id: 'other_user', password: '' })
      .expect(200);
    const cred = (await getCredential('c00', 'qualif'))!;
    expect(cred.user_id).toBe('other_user');
    expect(cred.password).toBe('Pa55-w0rd');
    expect(cred.extension_secrets).toEqual([SECRET]);
  });

  it('protects the connection test and validates its input', async () => {
    await request(app).post('/api/admin/credentials/test').send({ site_id: 'c00', environment: 'qualif' }).expect(401);
    const bad = await request(app)
      .post('/api/admin/credentials/test')
      .set('Authorization', 'Bearer admin')
      .send({ site_id: 'c00', environment: 'qualif', api_url: 'https://evil.example.com' })
      .expect(400);
    expect(bad.body.message).toContain('api_url');
  });

  it('lets a signed OneStock session configure its own site only', async () => {
    await request(app).get('/api/admin/credentials').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app)
      .put('/api/admin/credentials/c00/qualif')
      .set('Authorization', `Bearer ${token}`)
      .send({ user_id: 'from_onestock' })
      .expect(200);
    const other = await request(app).put('/api/admin/credentials/c42/qualif').set('Authorization', `Bearer ${token}`).send({ user_id: 'x', password: 'y' });
    expect(other.status).toBe(403);
  });
});

describe('GET /v3/items response', () => {
  // Real response: weight is an item field (55); a stray "weight" feature (0.001) exists in "en"; the name is in "fr" only
  const raw = {
    id: '00003',
    category_ids: ['Gros Electroménager'],
    is_default: true,
    product_id: '618065',
    features: {
      en: { weight: [0.001] },
      fr: { color: ['Noir'], image: ['https://example.com/G_618065_C.webp'], name: ['CANDY Réfri-congélateur combiné'] },
    },
    weight: 55,
  };
  it('keeps the weight field, the name of any language and the image', () => {
    for (const lang of ['en', 'fr']) {
      const item = simplifyItem(raw as never, lang);
      expect(item).toMatchObject({ id: '00003', name: 'CANDY Réfri-congélateur combiné', weight: 55, image: 'https://example.com/G_618065_C.webp' });
      expect(item.attributes?.weight).toEqual([55]);
    }
  });
});

describe('endpoint execution times', () => {
  it('accepts a list or an object {operation: id}', async () => {
    const { normalizeEndpointExecutionTimes } = await import('./routes.js');
    expect(normalizeEndpointExecutionTimes({ Paiement: 'et1', Picking: { id: 'et2' } })).toEqual([
      { id: 'et1', operation: 'Paiement' },
      { id: 'et2', operation: 'Picking' },
    ]);
    expect(normalizeEndpointExecutionTimes([{ id: 'et3', operation: 'Packing' }, 'et4'])).toEqual([{ id: 'et3', operation: 'Packing' }, { id: 'et4', operation: undefined }]);
    expect(normalizeEndpointExecutionTimes('x')).toBeUndefined();
  });
});
