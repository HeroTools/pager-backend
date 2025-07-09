import { SSMClient, PutParameterCommand, GetParameterCommand } from '@aws-sdk/client-ssm';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ssm = new SSMClient({});
const environment = process.argv[2] || 'dev';

interface Parameter {
  name: string;
  value: string;
  type: 'String' | 'SecureString';
  required?: boolean;
}

interface EnvironmentConfig {
  [key: string]: Parameter[];
}

async function loadConfig(): Promise<EnvironmentConfig> {
  const configPath = join(process.cwd(), 'config', 'parameters.json');

  if (!existsSync(configPath)) {
    console.error(
      '❌ Config file not found. Run: cp config/parameters.example.json config/parameters.json',
    );
    process.exit(1);
  }

  return JSON.parse(readFileSync(configPath, 'utf8'));
}

async function parameterExists(name: string): Promise<boolean> {
  try {
    await ssm.send(new GetParameterCommand({ Name: name }));
    return true;
  } catch {
    return false;
  }
}

async function setParameter(name: string, value: string, type: 'String' | 'SecureString') {
  const fullName = `/unowned/${environment}/${name}`;

  if (await parameterExists(fullName)) {
    console.log(`✓ Parameter ${fullName} already exists`);
    return;
  }

  if (!value || value === 'CHANGE_ME') {
    console.log(`⚠️  Skipping ${fullName} - no value provided`);
    return;
  }

  await ssm.send(
    new PutParameterCommand({
      Name: fullName,
      Value: value,
      Type: type,
      Description: `Unowned ${environment} environment`,
    }),
  );
  console.log(`✓ Created parameter ${fullName}`);
}

async function main() {
  const config = await loadConfig();
  const params = config[environment];

  if (!params) {
    console.error(`❌ No configuration found for environment: ${environment}`);
    process.exit(1);
  }

  console.log(`Setting up parameters for environment: ${environment}\n`);

  for (const param of params) {
    await setParameter(param.name, param.value, param.type);
  }

  console.log('\n✅ Setup complete!');
}

main().catch(console.error);
