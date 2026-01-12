#!/usr/bin/env node

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { getStage, getRegion, getTableName } = require('./config.js');

function parseFlags(argv) {
  const flags = new Set(argv.slice(2));
  return {
    telegram: flags.has('--telegram'),
    whatsapp: flags.has('--whatsapp'),
  };
}

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status || 1);
  }
}

(async () => {
  const { telegram, whatsapp } = parseFlags(process.argv);
  if (!telegram && !whatsapp) {
    console.error('Usage: node scripts/onboard-stage.mjs --telegram | --whatsapp');
    process.exit(1);
  }

  const stage = getStage();
  const region = getRegion();
  const tableName = getTableName();

  console.log('Onboarding stage environment');
  console.log(`  STAGE:      ${stage}`);
  console.log(`  AWS_REGION: ${region}`);
  console.log(`  TABLE_NAME: ${tableName}`);

  // 1) Country policies (required for both channels)
  run('node', ['scripts/seed-country-policies.mjs']);

  // 2) Channel-specific routing
  if (telegram) {
    run('node', ['scripts/seed-telegram-bot-mappings.mjs']);
  }
  if (whatsapp) {
    run('node', ['scripts/seed-whatsapp-mappings.mjs']);
  }

  // 3) Tenant demo (includes channels config from configs/tenant-demo.json)
  run('node', ['scripts/seedTenant.js', 'configs/tenant-demo.json']);

  console.log('\nOnboarding complete. Next steps:');
  if (telegram) {
    console.log('- Telegram:');
    console.log('  * Crea el bot en @BotFather y guarda el bot token en Secrets Manager.');
    console.log('  * Asegúrate de que tenant-demo tenga channels.telegram.botTokenSecretId apuntando a ese secreto.');
    console.log('  * Ejecuta setWebhook apuntando a /webhooks/telegram/{botKey} (p.ej. tg-demo).');
  }
  if (whatsapp) {
    console.log('- WhatsApp:');
    console.log('  * Configura el access token y app secret en Secrets Manager/SSM.');
    console.log('  * Configura el webhook en Meta apuntando a /webhooks/whatsapp con el verify token correcto.');
  }
})();
