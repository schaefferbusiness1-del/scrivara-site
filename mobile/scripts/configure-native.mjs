#!/usr/bin/env node
/* Applies the settings `npx cap add` does NOT set, to both native projects.
 *
 * Idempotent: safe to run after every `cap add` / `cap sync`, and a no-op when
 * everything is already in place. Each change below is either a store
 * requirement or a decision a clinical app has to make on purpose.
 *
 *   node mobile/scripts/configure-native.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'app.config.json'), 'utf8'));
const changes = [];
const skipped = [];

function edit(file, label, fn) {
  const p = path.join(MOBILE, file);
  if (!fs.existsSync(p)) { skipped.push(`${label} — ${file} not present (run \`npx cap add\` first)`); return; }
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after == null) { skipped.push(`${label} — already applied`); return; }
  if (after === before) { skipped.push(`${label} — already applied`); return; }
  fs.writeFileSync(p, after);
  changes.push(`${label}  (${file})`);
}

/* ======================= ANDROID ========================================= */

edit('android/app/build.gradle', 'version + release hardening + signing', (s) => {
  let out = s;

  /* versionCode/versionName come from app.config.json. Play rejects an upload
     whose versionCode is not strictly greater than the last one, so this being
     hand-edited in two places is a release-day failure waiting to happen. */
  out = out.replace(/versionCode \d+/, `versionCode ${cfg.androidVersionCode}`);
  out = out.replace(/versionName "[^"]*"/, `versionName "${cfg.version}"`);

  /* A clinical app must not have its private data auto-uploaded to the user's
     Google Drive backup. There is nothing on the device worth restoring anyway
     — the app holds a session token and nothing else. */
  if (!out.includes('// mlsscribe: release config')) {
    out = out.replace(
      /    buildTypes \{\n        release \{\n            minifyEnabled false\n            proguardFiles getDefaultProguardFile\('proguard-android.txt'\), 'proguard-rules.pro'\n        \}\n    \}/,
      `    // mlsscribe: release config
    signingConfigs {
        release {
            // Supplied by keystore.properties (local) or by the CI workflow's
            // secrets. Absent = an unsigned build, which is what you want on a
            // machine that has no business holding the upload key.
            def props = new Properties()
            def f = rootProject.file("keystore.properties")
            if (f.exists()) {
                props.load(new FileInputStream(f))
                storeFile file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
            if (rootProject.file("keystore.properties").exists()) {
                signingConfig signingConfigs.release
            }
        }
    }`
    );
  }
  return out;
});

edit('android/app/src/main/AndroidManifest.xml', 'no cloud backup, no cleartext', (s) => {
  let out = s;
  out = out.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  if (!out.includes('android:usesCleartextTraffic')) {
    out = out.replace(
      'android:allowBackup="false"',
      'android:allowBackup="false"\n        android:usesCleartextTraffic="false"'
    );
  }
  if (!out.includes('android:dataExtractionRules') && !out.includes('fullBackupContent')) {
    /* Android 12+ reads a separate rules file; with backup off it is belt and
       braces, but "off" should be unambiguous in both places. */
    out = out.replace(
      'android:allowBackup="false"',
      'android:allowBackup="false"\n        android:fullBackupContent="false"'
    );
  }
  /* Portrait only: this app is a list and a button. A landscape layout would
     be a second layout to keep honest, for no clinical gain. */
  out = out.replace(
    'android:launchMode="singleTask"',
    'android:launchMode="singleTask"\n            android:screenOrientation="portrait"'
  );
  return out;
});

/* ======================= iOS ============================================= */

edit('ios/App/App/Info.plist', 'portrait only, export compliance, version', (s) => {
  let out = s;

  /* Portrait only, iPhone and iPad alike — same reason as Android. */
  out = out.replace(
    /<key>UISupportedInterfaceOrientations<\/key>\s*<array>[\s\S]*?<\/array>/,
    `<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
	</array>`
  );
  out = out.replace(
    /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>/,
    `<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
	</array>`
  );

  /* Without this, App Store Connect asks the export-compliance question on
     EVERY upload and holds the build until it is answered by hand. The app
     uses only HTTPS, which is exactly the exemption this key declares. */
  if (!out.includes('ITSAppUsesNonExemptEncryption')) {
    out = out.replace(
      '<key>LSRequiresIPhoneOS</key>',
      '<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n\t<key>LSRequiresIPhoneOS</key>'
    );
  }

  /* armv7 has not existed since the iPhone 5; leaving it in the required
     capabilities is a legacy template artifact. */
  out = out.replace(
    /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>armv7<\/string>\s*<\/array>/,
    `<key>UIRequiredDeviceCapabilities</key>
	<array>
		<string>arm64</string>
	</array>`
  );
  return out;
});

edit('ios/App/App.xcodeproj/project.pbxproj', 'marketing version + build number', (s) => {
  let out = s;
  out = out.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${cfg.version};`);
  out = out.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${cfg.iosBuildNumber};`);
  out = out.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, `PRODUCT_BUNDLE_IDENTIFIER = ${cfg.appId};`);
  return out;
});

/* ======================= report ========================================== */
if (changes.length) {
  console.log('applied:');
  for (const c of changes) console.log('  + ' + c);
} else {
  console.log('nothing to change.');
}
if (skipped.length) {
  console.log('skipped:');
  for (const s of skipped) console.log('  · ' + s);
}
console.log(`\n${cfg.displayName} ${cfg.version} (android ${cfg.androidVersionCode} / ios ${cfg.iosBuildNumber})  ${cfg.appId}`);
