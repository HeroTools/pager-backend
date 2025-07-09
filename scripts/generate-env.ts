#!/usr/bin/env tsx

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const environment = process.argv[2] || 'dev';
const configPath = join(process.cwd(), 'config', 'parameters.json');
const templatePath = join(process.cwd(), 'template.yaml');

if (!existsSync(configPath)) {
  console.error(
    '❌ Config file not found. Run: cp config/parameters.example.json config/parameters.json',
  );
  process.exit(1);
}

if (!existsSync(templatePath)) {
  console.error('❌ template.yaml not found');
  process.exit(1);
}

// Define CloudFormation YAML types to avoid parsing errors
const CloudFormationSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('!Ref', { kind: 'scalar', construct: (data) => ({ Ref: data }) }),
  new yaml.Type('!Equals', { kind: 'sequence', construct: (data) => ({ 'Fn::Equals': data }) }),
  new yaml.Type('!Not', { kind: 'sequence', construct: (data) => ({ 'Fn::Not': data }) }),
  new yaml.Type('!Sub', { kind: 'scalar', construct: (data) => ({ 'Fn::Sub': data }) }),
  new yaml.Type('!Join', { kind: 'sequence', construct: (data) => ({ 'Fn::Join': data }) }),
  new yaml.Type('!Select', { kind: 'sequence', construct: (data) => ({ 'Fn::Select': data }) }),
  new yaml.Type('!Split', { kind: 'sequence', construct: (data) => ({ 'Fn::Split': data }) }),
  new yaml.Type('!GetAtt', { kind: 'scalar', construct: (data) => ({ 'Fn::GetAtt': data }) }),
  new yaml.Type('!GetAZs', { kind: 'scalar', construct: (data) => ({ 'Fn::GetAZs': data }) }),
  new yaml.Type('!ImportValue', {
    kind: 'scalar',
    construct: (data) => ({ 'Fn::ImportValue': data }),
  }),
  new yaml.Type('!Base64', { kind: 'scalar', construct: (data) => ({ 'Fn::Base64': data }) }),
  new yaml.Type('!If', { kind: 'sequence', construct: (data) => ({ 'Fn::If': data }) }),
]);

// Parse template.yaml to get all Lambda functions
const templateContent = readFileSync(templatePath, 'utf8');
const template = yaml.load(templateContent, { schema: CloudFormationSchema }) as any;

const functions: string[] = [];
if (template.Resources) {
  Object.entries(template.Resources).forEach(([name, resource]: [string, any]) => {
    if (resource.Type === 'AWS::Serverless::Function') {
      functions.push(name);
    }
  });
}

console.log(`🔍 Found ${functions.length} Lambda functions in template.yaml`);

// Parse parameters
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const params = config[environment];

if (!params) {
  console.error(`❌ No configuration found for environment: ${environment}`);
  process.exit(1);
}

// Convert parameter names to environment variable names
const envVars: Record<string, string> = {};
params.forEach((param: any) => {
  if (param.value && param.value !== 'CHANGE_ME') {
    const envKey = param.name.toUpperCase().replace(/-/g, '_');
    envVars[envKey] = param.value;
  }
});

// Create env.json with same vars for all functions
const envJson: Record<string, typeof envVars> = {};
functions.forEach((funcName) => {
  envJson[funcName] = { ...envVars };
});

writeFileSync('env.json', JSON.stringify(envJson, null, 2));
console.log(`✅ Generated env.json from ${environment} parameters`);
console.log(`📋 Environment variables set for ${functions.length} functions`);

// Show what was generated (hide sensitive values)
console.log('\n🔧 Generated variables:');
Object.keys(envVars).forEach((key) => {
  const value = envVars[key];
  const displayValue =
    key.includes('SECRET') || key.includes('PASSWORD') || key.includes('KEY')
      ? '***HIDDEN***'
      : value.length > 50
        ? value.substring(0, 47) + '...'
        : value;
  console.log(`  ${key}: ${displayValue}`);
});

console.log(
  `\n🎯 Applied to functions: ${functions.slice(0, 3).join(', ')}${functions.length > 3 ? ` ... and ${functions.length - 3} more` : ''}`,
);
