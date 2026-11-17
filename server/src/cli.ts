/**
 * Manage the OneStock API credentials stored (encrypted) in the database.
 *
 *   npm run creds -- list [site_id]
 *   npm run creds -- set --site c00 --env qualif --user my_api_user --password '***' \
 *        [--api-url https://c00.api.qualif.onestock-retail.com] [--secret <hash>]... [--label "Qualif"]
 *   npm run creds -- delete --site c00 --env qualif
 */
import { parseArgs } from 'node:util';
import { deleteCredential, listCredentials, upsertCredential } from './credentials.js';

const [command = 'list', ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    site: { type: 'string' },
    env: { type: 'string' },
    user: { type: 'string' },
    password: { type: 'string' },
    'api-url': { type: 'string' },
    secret: { type: 'string', multiple: true },
    label: { type: 'string' },
  },
});

switch (command) {
  case 'list':
    console.table(await listCredentials(positionals[0] ?? values.site));
    break;
  case 'set': {
    const password = values.password ?? process.env.ONESTOCK_PASSWORD;
    await upsertCredential({
      site_id: values.site ?? '',
      environment: values.env ?? '',
      user_id: values.user ?? '',
      password: password ?? '',
      api_url: values['api-url'],
      extension_secrets: values.secret,
      label: values.label,
    });
    console.log(`Credentials saved for ${values.site}/${values.env}`);
    break;
  }
  case 'delete':
    console.log((await deleteCredential(values.site ?? '', values.env ?? '')) ? 'Deleted' : 'Not found');
    break;
  default:
    console.error(`Unknown command ${command}. Use list | set | delete`);
    process.exit(1);
}
