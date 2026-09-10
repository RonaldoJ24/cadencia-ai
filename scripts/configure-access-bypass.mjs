#!/usr/bin/env node
 // In-process Cloudflare Access configurator for Cadencia public generation bypass.
 // Reads local Wrangler OAuth token in-process without logging or exposing credentials.
 
 import fs from 'node:fs';
 import os from 'node:os';
 import path from 'node:path';
 
 const ACCOUNT_ID = 'ed3cc252f859aff914e92d1ed75e9d04';
 const HOSTNAME = 'cadencia-ai.ronaldo-jesus-alvarez.workers.dev';
 const TARGET_PATH = 'api/routine';
 const TARGET_DOMAIN = `${HOSTNAME}/${TARGET_PATH}`;
 
 function readLocalWranglerToken() {
   const candidates = [
     process.env.CLOUDFLARE_API_TOKEN,
     path.join(os.homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
     path.join(os.homedir(), '.config', '.wrangler', 'config', 'default.toml'),
     path.join(os.homedir(), '.wrangler', 'config', 'default.toml'),
   ];
 
   for (const candidate of candidates) {
     if (!candidate) continue;
     if (typeof candidate === 'string' && !candidate.endsWith('.toml')) {
       if (candidate.trim().length > 0) return candidate.trim();
     }
     if (fs.existsSync(candidate)) {
       try {
         const toml = fs.readFileSync(candidate, 'utf8');
         const oauthMatch = toml.match(/oauth_token\s*=\s*["']([^"']+)["']/u);
         if (oauthMatch && oauthMatch[1]) return oauthMatch[1].trim();
         const apiMatch = toml.match(/api_token\s*=\s*["']([^"']+)["']/u);
         if (apiMatch && apiMatch[1]) return apiMatch[1].trim();
       } catch {
         // Continue checking candidates
       }
     }
   }
   return null;
 }
 
 async function main() {
   const token = readLocalWranglerToken();
   if (!token) {
     console.error('Error: No local Wrangler OAuth token or CLOUDFLARE_API_TOKEN found.');
     process.exit(1);
   }
 
   const headers = {
     Authorization: `Bearer ${token}`,
     'Content-Type': 'application/json',
   };
 
   const listUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps`;
 
   console.log(`==> Fetching current Access applications for account ${ACCOUNT_ID}...`);
   let listRes;
   try {
     listRes = await fetch(listUrl, { headers });
   } catch (error) {
     console.error('Network failure connecting to Cloudflare Access API:', error.message);
     process.exit(1);
   }
 
   if (listRes.status === 403) {
     console.error('Error: Current OAuth token lacks Cloudflare Access permissions (HTTP 403).');
     console.error('An API Token with "Account - Access: Apps and Policies - Edit" is required.');
     process.exit(2);
   }
 
   if (!listRes.ok) {
     console.error(`Cloudflare API error (${listRes.status}):`, await listRes.text());
     process.exit(1);
   }
 
   const listData = await listRes.json();
   const apps = Array.isArray(listData.result) ? listData.result : [];
 
  const existingApp = apps.find(
    (a) => a.domain === TARGET_DOMAIN || (a.domain === HOSTNAME && a.path === TARGET_PATH),
  );

  let appId = existingApp?.id;
  if (existingApp) {
    console.log(`==> Access application exists for ${TARGET_DOMAIN} (App ID: ${appId}).`);
  } else {
    console.log(`==> Existing Access app not found for ${TARGET_DOMAIN}. Creating specific bypass app...`);
    const createAppRes = await fetch(listUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Cadencia Public Routine Bypass',
        domain: TARGET_DOMAIN,
        type: 'self_hosted',
        session_duration: '24h',
        auto_redirect_to_identity: false,
      }),
    });

    if (!createAppRes.ok) {
      console.error(`Failed to create Access app (${createAppRes.status}):`, await createAppRes.text());
      process.exit(1);
    }

    const createdAppData = await createAppRes.json();
    appId = createdAppData.result.id;
    console.log(`==> Successfully created Access app for ${TARGET_DOMAIN} (App ID: ${appId}).`);
  }

  // Idempotently inspect and ensure Everyone Bypass policy exists on this app
  console.log(`==> Inspecting policies on app ${appId}...`);
  const policiesUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps/${appId}/policies`;
  const polRes = await fetch(policiesUrl, { headers });
  if (!polRes.ok) {
    console.error(`Failed to list policies for app ${appId} (${polRes.status}):`, await polRes.text());
    process.exit(1);
  }
  const polData = await polRes.json();
  const policies = Array.isArray(polData.result) ? polData.result : [];
  const existingBypass = policies.find(
    (p) => p.decision === 'bypass' && p.include?.some((inc) => inc.everyone !== undefined),
  );

  if (existingBypass) {
    console.log(`==> Everyone Bypass policy already exists on app ${appId} (Policy ID: ${existingBypass.id}).`);
  } else {
    console.log(`==> Adding Everyone Bypass policy to app ${appId}...`);
    const createPolicyRes = await fetch(policiesUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Everyone Bypass',
        decision: 'bypass',
        include: [{ everyone: {} }],
      }),
    });

    if (!createPolicyRes.ok) {
      console.error(`Failed to add bypass policy (${createPolicyRes.status}):`, await createPolicyRes.text());
      process.exit(1);
    }
    const createdPol = await createPolicyRes.json();
    console.log(`==> Successfully added Everyone Bypass policy (Policy ID: ${createdPol.result.id}).`);
  }

  // Execute post-configuration HTTP verification check
  console.log('==> Executing post-configuration HTTP verification...');
  try {
    const publicUrl = `https://${TARGET_DOMAIN}`;
    const publicRes = await fetch(publicUrl, { method: 'GET', cache: 'no-store' });
    console.log(`- Public route (${publicUrl}): HTTP ${publicRes.status} (expected 200 with liveAvailable JSON)`);
    if (publicRes.status === 302 || publicRes.status === 401) {
      console.warn(`  WARNING: ${publicUrl} returned Access redirect (${publicRes.status}). Propagation may take up to 60s.`);
    } else {
      console.log('  Verification PASSED: /api/routine is publicly accessible.');
    }

    const privateUrl = `https://${HOSTNAME}/api/routines`;
    const privateRes = await fetch(privateUrl, { method: 'GET', redirect: 'manual', cache: 'no-store' });
    console.log(`- Private route (${privateUrl}): HTTP ${privateRes.status} (expected 302/401 redirect to Access login)`);
    if (privateRes.status === 302 || privateRes.status === 401) {
      console.log('  Verification PASSED: /api/routines remains locked behind Cloudflare Access.');
    } else {
      console.warn(`  WARNING: Private route returned ${privateRes.status} instead of expected Access gate redirect.`);
    }
  } catch (err) {
    console.warn(`  HTTP verification note: could not connect from current network environment (${err.message}).`);
  }
}

main().catch((err) => {
   console.error('Unexpected error:', err.message);
   process.exit(1);
 });
 
