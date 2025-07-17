#!/usr/bin/env ts-node

import {
  CreateSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// --- Configuration -------------------------------------------------------
const PROFILE = process.env.AWS_PROFILE || 'unowned-prod';
const REGION = process.env.AWS_REGION || 'us-east-2';

const creds = fromIni({ profile: PROFILE });
const client = new SecretsManagerClient({ region: REGION, credentials: creds });

// --- Types ----------------------------------------------------------------
interface Parameter {
  name: string;
  value: string;
  required?: boolean;
}

interface EnvironmentConfig {
  [env: string]: Parameter[];
}

// --- Load JSON config ----------------------------------------------------
async function loadConfig(): Promise<EnvironmentConfig> {
  const configPath = join(process.cwd(), 'config', 'parameters.json');
  if (!existsSync(configPath)) {
    console.error(`❌ Config file not found at ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

// --- Upsert logic --------------------------------------------------------
async function createSecret(name: string, value: string) {
  await client.send(new CreateSecretCommand({ Name: name, SecretString: value }));
}

async function updateSecret(name: string, value: string) {
  await client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
}

async function upsertSecret(name: string, value: string) {
  try {
    // Check if secret exists
    await client.send(new DescribeSecretCommand({ SecretId: name }));
    // If we got here, it exists → update
    await updateSecret(name, value);
    console.log(`🔄 Updated secret: ${name}`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException') {
      // Doesn't exist → create
      await createSecret(name, value);
      console.log(`✅ Created secret: ${name}`);
    } else {
      // Unknown error
      console.error(`❌ Error on upsertSecret(${name}):`, err);
      process.exit(1);
    }
  }
}

// --- Main ----------------------------------------------------------------
async function main() {
  const environment = process.argv[2] || 'dev';
  if (!['dev', 'prod'].includes(environment)) {
    console.error("❌ Invalid environment. Must be 'dev' or 'prod'");
    process.exit(1);
  }

  const stackName = environment === 'dev' ? 'unowned-dev' : 'unowned';
  const config = await loadConfig();
  const params = config[environment];

  if (!params) {
    console.error(`❌ No configuration found for environment: ${environment}`);
    process.exit(1);
  }

  console.log(`🔐 Syncing Secrets Manager entries for environment: ${environment}`);

  for (const p of params) {
    const { name, value, required } = p;
    if (!value || value === 'CHANGE_ME') {
      if (required) {
        console.error(`❌ Required secret "/${stackName}/${environment}/${name}" has no value`);
        process.exit(1);
      } else {
        console.warn(`⚠️  Skipping optional secret "/${stackName}/${environment}/${name}"`);
        continue;
      }
    }

    const fullName = `/${stackName}/${environment}/${name}`;
    await upsertSecret(fullName, value);
  }

  console.log(`🎉 All secrets in sync!`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
