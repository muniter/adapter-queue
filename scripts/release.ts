#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const VALID_VERSIONS = ['patch', 'minor', 'major', 'keep', 'beta'];

function run(command: string): string {
  console.log(`\n> ${command}`);
  return execSync(command, { encoding: 'utf8', stdio: 'inherit' }) as unknown as string;
}

function getVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  return packageJson.version;
}

function getBetaVersion(currentVersion: string): string {
  // Extract the base version (remove any existing beta suffix)
  const baseVersion = currentVersion.replace(/-beta\.\d+$/, '');
  
  // Check if there's already a beta version
  const betaMatch = currentVersion.match(/-beta\.(\d+)$/);
  const betaNumber = betaMatch ? parseInt(betaMatch[1]) + 1 : 1;
  
  return `${baseVersion}-beta.${betaNumber}`;
}

async function main() {
  const versionType = process.argv[2];
  
  if (!versionType || !VALID_VERSIONS.includes(versionType)) {
    console.error(`\nUsage: pnpm release <version>\n`);
    console.error(`Where <version> is one of: ${VALID_VERSIONS.join(', ')}\n`);
    console.error('Examples:');
    console.error('  pnpm release patch     # 0.0.1 -> 0.0.2');
    console.error('  pnpm release minor     # 0.0.1 -> 0.1.0');
    console.error('  pnpm release major     # 0.0.1 -> 1.0.0');
    console.error('  pnpm release beta      # 0.0.1 -> 0.0.1-beta.1');
    console.error('  pnpm release keep      # Keep current version\n');
    process.exit(1);
  }

  console.log('🚀 Starting release process...\n');

  // 1. Check git status
  console.log('📋 Checking git status...');
  try {
    execSync('git diff-index --quiet HEAD --', { stdio: 'pipe' });
  } catch {
    console.error('\n❌ Error: You have uncommitted changgg/es. Please commit or stash them first.\n');
    process.exit(1);
  }

  // 2. Pull latest changes
  console.log('📥 Pulling latest changes...');
  run('git pull');

  // 3. Install dependencies
  console.log('\n📦 Installing dependencies...');
  run('pnpm install');

  // 4. Run build
  console.log('\n🔨 Building project...');
  run('pnpm run build');

  // 5. Run tests
  console.log('\n🧪 Running tests...');
  run('pnpm test');

  // 6. Bump version (if not "keep")
  const oldVersion = getVersion();
  let newVersion = oldVersion;
  
  if (versionType === 'keep') {
    console.log(`\n📝 Keeping version at ${oldVersion}`);
  } else if (versionType === 'beta') {
    newVersion = getBetaVersion(oldVersion);
    console.log(`\n📝 Creating beta version: ${oldVersion} -> ${newVersion}`);
    
    // Update package.json with the new beta version
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packageJson.version = newVersion;
    
    // Write the updated package.json
    const fs = await import('fs/promises');
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`   Version set to ${newVersion}`);
  } else {
    console.log(`\n📝 Bumping version from ${oldVersion}...`);
    run(`npm version ${versionType} --no-git-tag-version`);
    newVersion = getVersion();
    console.log(`   Version bumped to ${newVersion}`);
  }

  // 7. Create git commit and tag
  console.log('\n📌 Creating git commit and tag...');
  if (versionType !== 'keep') {
    run('git add package.json');
    const commitMessage = versionType === 'beta' 
      ? `chore: release ${newVersion} (beta)`
      : `chore: release v${newVersion}`;
    run(`git commit -m "${commitMessage}"`);
  }
  run(`git tag ${newVersion}`);

  // 8. Push changes
  console.log('\n📤 Pushing changes to remote...');
  run('git push');
  run('git push --tags');

  // 9. Show publish command
  console.log('\n✅ Release preparation complete!\n');
  console.log(`📦 Version ${newVersion} is ready to publish.\n`);
  
  if (versionType === 'beta') {
    console.log('To publish this beta version to npm, run:');
    console.log(`\n  pnpm publish --tag beta\n`);
    console.log('Or if this is the first publish:');
    console.log(`\n  pnpm publish --tag beta --access public\n`);
    console.log('\nNote: Beta versions are published with the "beta" tag, not "latest".');
  } else {
    console.log('To publish to npm, run:');
    console.log(`\n  pnpm publish\n`);
    console.log('Or if this is the first publish:');
    console.log(`\n  pnpm publish --access public\n`);
  }
}

main().catch((error) => {
  console.error('\n❌ Release failed:', error.message);
  process.exit(1);
});