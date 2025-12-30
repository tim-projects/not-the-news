#!/usr/bin/env node

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("--- Firebase Connection Verification (Node) ---");

  // 1. Load .env.development
  const envPath = path.resolve(process.cwd(), '.env.development');
  if (!fs.existsSync(envPath)) {
    console.error("ERROR: .env.development not found!");
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  envContent.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, ...rest] = line.split('=');
      let val = rest.join('=').trim();
      // Remove quotes
      val = val.replace(/^["']|["']$/g, '');
      env[key.trim()] = val;
    }
  });

  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!projectId || !email || !privateKey) {
    console.error("ERROR: Missing required variables in .env.development");
    process.exit(1);
  }

  // Handle newlines in key
  privateKey = privateKey.replace(/\\n/g, '\n');

  console.log("1. Config check: OK");
  console.log(`   Project: ${projectId}`);
  console.log(`   Email: ${email}`);

  // 2. Generate JWT and get Token
  console.log("\n2. Attempting to get Google Access Token...");
  
  const token = await getAccessToken(email, privateKey);
  console.log("   SUCCESS: Obtained Access Token.");

  // 3. Read Firestore
  console.log("\n3. Attempting Firestore REST Read...");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`;
  
  try {
    const data = await httpsGet(url, token);
    console.log("   SUCCESS: Firestore connected and read successful.");
    console.log("   Data preview:", JSON.stringify(data).substring(0, 100) + "...");
    console.log("\nCONCLUSION: Firebase Configuration and Connection are VALID.");
  } catch (e) {
    if (e.statusCode === 404) {
        console.log("   SUCCESS: Firestore connected, but path not found (404). This is valid proof of connection.");
        console.log("\nCONCLUSION: Firebase Configuration and Connection are VALID.");
    } else {
        console.error("   FAILED: Firestore read error:", e.message);
        console.error("   Body:", e.body);
        process.exit(1);
    }
  }
}

function base64Url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(email, privateKey) {
  const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    iss: email,
    sub: email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  });

  const encodedHeader = base64Url(header);
  const encodedPayload = base64Url(payload);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(encodedHeader + '.' + encodedPayload);
  const signature = signer.sign(privateKey, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const data = JSON.parse(body);
        if (data.access_token) resolve(data.access_token);
        else reject(new Error("No access token in response: " + body));
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.body = body;
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
