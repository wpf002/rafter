import { buildServer } from './server';

const port = Number(process.env.API_PORT ?? 4000);

async function main(): Promise<void> {
  const app = buildServer();
  await app.listen({ port, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`@rafter/api listening on :${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
