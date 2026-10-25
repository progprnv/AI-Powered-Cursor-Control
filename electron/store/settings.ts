import Store from 'electron-store';
import { app } from 'electron';
import { join } from 'node:path';
import { createDecipheriv, createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { MODELS } from '../llm/models';
import type { ProviderId, ProviderSettings, Settings, UserProfile } from '../types';
import {
  decryptProviders,
  encryptProviders,
  isEncryptionAvailable,
  type SecureProviderMap,
} from './secure-keys';

// Storage architecture (v1):
//
//   - config.json is PLAIN JSON, always valid, always JSON.parse-able. This
//     is what fixed the v1.0.0 settings persistence loop: the prior build
//     handed electron-store an `encryptionKey`, so every write produced a
//     binary AES-CBC envelope on disk; the next start could not JSON.parse
//     it, the recovery branch fired, a fresh binary file was written, and
//     the loop repeated. Plain JSON eliminates that entire class of bug.
//
//   - API keys live INSIDE the JSON as safeStorage-encrypted base64 strings
//     (see ./secure-keys.ts). That gives us "encrypted at rest" without the
//     file-level encryption that caused the loop. safeStorage is used as a
//     field-level helper, not a file wrapper.
//
//   - `storageVersion` is the version of the on-disk schema. Bumped when the
//     shape changes. On read, an older / missing version triggers migration.
//
// Anything written through electron-store is now atomic (conf v10 uses the
// `atomically` package internally), so a crash mid-write cannot leave the
// file half-written.

type Schema = {
  // On-disk schema version. v1 = the post-bugfix plain-JSON layout.
  storageVersion: number;
  // Legacy plaintext slot. Kept readable so we can migrate any pre-existing
  // OpenRouter key on first launch, then cleared.
  openrouterApiKey: string;
  primaryModel: string;
  fallbackModel: string;
  webSearch: boolean;
  workspaceFolder: string;
  // Legacy plaintext provider map. Migrated into providersSecure on first
  // read and then blanked out.
  providers: Record<ProviderId, ProviderSettings>;
  // Active provider map. API keys are safeStorage-encrypted base64 strings;
  // see ./secure-keys.ts.
  providersSecure: SecureProviderMap | null;
  autoApproveTools: boolean;
  memorySaveEnabled: boolean;
  maxContextTokens: number;
  voiceLanguage: string;
  triggerHotkey: 'MetaRight' | 'CtrlLeft' | 'CtrlRight' | 'AltRight' | 'ShiftRight';
  userProfile: UserProfile;
  // GDPR-friendly default: profile data is NOT injected into the system
  // prompt unless the user explicitly opts in.
  personalizePrompts: boolean;
  dismissOnDoubleClick: boolean;
  // Auto-update check schedule. Default on.
  autoCheckUpdates: boolean;
  // Voice-first conversation mode. Off by default.
  audioMode: boolean;
};

const STORAGE_VERSION = 1;

// Internal builds before v1.0.0-final used electron-store with a hardcoded
// envelope key derived from this string. We keep the constant ONLY so the
// recovery path can decrypt those legacy files once on upgrade. New writes
// never use it; new files are plain JSON.
const LEGACY_ENVELOPE_KEY = 'aipointer-v1-local-obfuscation';
const LEGACY_KEY_DERIVED = createHash('sha256').update(LEGACY_ENVELOPE_KEY).digest();

const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  role: '',
  preferredLanguage: '',
};

const defaultTriggerHotkey = (): 'MetaRight' | 'CtrlLeft' =>
  process.platform === 'darwin' ? 'MetaRight' : 'CtrlLeft';

const DEFAULT_PROVIDERS: Record<ProviderId, ProviderSettings> = {
  openrouter: { apiKey: '', enabled: true },
  anthropic: { apiKey: '', enabled: false },
  openai: { apiKey: '', enabled: false },
  gemini: { apiKey: '', enabled: false },
  deepseek: { apiKey: '', enabled: false },
};

const defaultWorkspace = (): string => {
  try {
    return join(app.getPath('documents'), 'AICursor');
  } catch {
    return join(process.env.HOME ?? '/tmp', 'AICursor');
  }
};

const STORE_DEFAULTS: Schema = {
  storageVersion: STORAGE_VERSION,
  openrouterApiKey: '',
  primaryModel: MODELS.PRIMARY,
  fallbackModel: MODELS.FALLBACK,
  webSearch: false,
  workspaceFolder: defaultWorkspace(),
  providers: DEFAULT_PROVIDERS,
  providersSecure: null,
  autoApproveTools: false,
  memorySaveEnabled: false,
  maxContextTokens: 8000,
  voiceLanguage: 'auto',
  triggerHotkey: defaultTriggerHotkey(),
  userProfile: DEFAULT_USER_PROFILE,
  personalizePrompts: false,
  dismissOnDoubleClick: true,
  autoCheckUpdates: true,
  audioMode: false,
};

// Heuristic: does the file on disk look like a legacy electron-store
// encrypted blob? Plain JSON starts (after whitespace) with `{` or `[`;
// anything else is treated as binary and routed through the legacy
// recovery path. We only need to look at the first non-whitespace byte.
function looksLikeBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 64);
  for (let i = 0; i < limit; i++) {
    const byte = buf[i];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte === 0x7b || byte === 0x5b) return false; // '{' or '['
    return true;
  }
  // All-whitespace or empty file: treat as plain (electron-store will write defaults).
  return false;
}

// Attempt to decrypt a legacy electron-store @ conf v10 file using the
// hardcoded LEGACY_ENVELOPE_KEY. Layout: 16-byte IV || AES-256-CBC ciphertext.
// Returns the parsed JSON object, or null if the file was not encrypted with
// this key (e.g. it was encrypted with a per-install random key from the
// broken intermediate build, which is unrecoverable).
function tryLegacyDecrypt(rawBuf: Buffer): Record<string, unknown> | null {
  if (rawBuf.length < 32) return null;
  try {
    const iv = rawBuf.subarray(0, 16);
    const ciphertext = rawBuf.subarray(16);
    const decipher = createDecipheriv('aes-256-cbc', LEGACY_KEY_DERIVED, iv);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const text = plain.toString('utf-8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function quarantine(configPath: string): string {
  const stamp = Date.now();
  const corruptedPath = `${configPath}.corrupted-${stamp}`;
  try {
    renameSync(configPath, corruptedPath);
    return corruptedPath;
  } catch (err) {
    // If we can't rename the file out of the way, we have to remove it so the
    // fresh-store construction below does not re-trigger the same parse error.
    // We log the failure but proceed; the user's data is unrecoverable in
    // either case.
    console.warn('[settings] could not rename corrupt config:', err);
    try {
      unlinkSync(configPath);
      console.warn('[settings] removed corrupt config in place');
    } catch (unlinkErr) {
      console.warn('[settings] could not remove corrupt config:', unlinkErr);
    }
    return '';
  }
}

function buildFreshStore(): Store<Schema> {
  // NO encryptionKey. The file is plain JSON. API keys inside it are
  // safeStorage-encrypted at the FIELD level via providersSecure.
  return new Store<Schema>({
    name: 'config',
    defaults: STORE_DEFAULTS,
  });
}

// Inspect the on-disk file BEFORE handing it to electron-store. This is the
// critical change vs. the v1.0.0 codepath: we never let electron-store crash
// on a non-JSON file, because we move that file out of the way first.
function buildStoreWithRecovery(): Store<Schema> {
  const configPath = join(app.getPath('userData'), 'config.json');

  if (!existsSync(configPath)) {
    // Fresh install. Nothing to migrate.
    return buildFreshStore();
  }

  let raw: Buffer;
  try {
    raw = readFileSync(configPath);
  } catch (err) {
    console.warn('[settings] could not read config.json, starting fresh:', err);
    return buildFreshStore();
  }

  // Empty file: let electron-store seed defaults.
  if (raw.length === 0) {
    return buildFreshStore();
  }

  if (looksLikeBinary(raw)) {
    // Legacy encrypted file (electron-store with encryptionKey from an old
    // build). Try to decrypt with the hardcoded key. If that fails, the file
    // was encrypted with a per-install random key from the broken build
    // and is unrecoverable.
    const migrated = tryLegacyDecrypt(raw);
    const quarantined = quarantine(configPath);
    const fresh = buildFreshStore();

    if (migrated) {
      applyMigratedValues(fresh, migrated);
      console.log(
        `[settings] migrated legacy config (old file preserved at ${
          quarantined || 'n/a'
        }).`,
      );
    } else {
      console.log(
        `[settings] could not migrate legacy config, starting fresh (old file preserved at ${
          quarantined || '(no prior file)'
        }).`,
      );
    }
    fresh.set('storageVersion', STORAGE_VERSION);
    return fresh;
  }

  // File looks like JSON. Validate up front so we can quarantine on parse
  // failure rather than letting electron-store throw inside its constructor.
  try {
    JSON.parse(raw.toString('utf-8'));
  } catch (err) {
    console.warn(
      '[settings] config.json present but unparseable, quarantining:',
      err instanceof Error ? err.message : err,
    );
    const quarantined = quarantine(configPath);
    const fresh = buildFreshStore();
    fresh.set('storageVersion', STORAGE_VERSION);
    console.log(
      `[settings] quarantined unparseable config at ${
        quarantined || '(no prior file)'
      }, starting fresh.`,
    );
    return fresh;
  }

  // Happy path: file exists and is valid JSON. electron-store reads it.
  return buildFreshStore();
}

// Copy any recognized fields from a decrypted legacy blob onto the fresh
// store. Unknown fields are ignored: this is a recovery path, not a faithful
// round-trip.
function applyMigratedValues(target: Store<Schema>, src: Record<string, unknown>): void {
  const setIf = <K extends keyof Schema>(key: K, ok: (v: unknown) => boolean): void => {
    if (key in src && ok(src[key as string])) {
      target.set(key, src[key as string] as Schema[K]);
    }
  };
  setIf('openrouterApiKey', (v) => typeof v === 'string');
  setIf('primaryModel', (v) => typeof v === 'string' && (v as string).length > 0);
  setIf('fallbackModel', (v) => typeof v === 'string' && (v as string).length > 0);
  setIf('webSearch', (v) => typeof v === 'boolean');
  setIf('workspaceFolder', (v) => typeof v === 'string' && (v as string).length > 0);
  setIf('providers', (v) => !!v && typeof v === 'object');
  setIf('providersSecure', (v) => v === null || (typeof v === 'object' && v !== null));
  setIf('autoApproveTools', (v) => typeof v === 'boolean');
  setIf('memorySaveEnabled', (v) => typeof v === 'boolean');
  setIf('maxContextTokens', (v) => typeof v === 'number' && Number.isFinite(v));
  setIf('voiceLanguage', (v) => typeof v === 'string');
  setIf(
    'triggerHotkey',
    (v) =>
      v === 'MetaRight' ||
      v === 'CtrlLeft' ||
      v === 'CtrlRight' ||
      v === 'AltRight' ||
      v === 'ShiftRight',
  );
  setIf('userProfile', (v) => !!v && typeof v === 'object');
  setIf('personalizePrompts', (v) => typeof v === 'boolean');
  setIf('dismissOnDoubleClick', (v) => typeof v === 'boolean');
  setIf('autoCheckUpdates', (v) => typeof v === 'boolean');
  setIf('audioMode', (v) => typeof v === 'boolean');
}

// Opportunistic GC: delete quarantined config files older than 7 days so the
// user's Application Support folder does not accumulate copies forever. Not
// security-critical; we just don't want a janitor task running over them.
function cleanupOldQuarantinedConfigs(): void {
  try {
    const userData = app.getPath('userData');
    if (!existsSync(userData)) return;
    const entries = readdirSync(userData);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const name of entries) {
      if (!name.startsWith('config.json.corrupted-')) continue;
      const full = join(userData, name);
      try {
        const st = statSync(full);
        if (now - st.mtimeMs > sevenDaysMs) {
          unlinkSync(full);
          console.log(`[settings] removed stale quarantined config: ${name}`);
        }
      } catch {
        /* ignore: file vanished or unreadable */
      }
    }
  } catch {
    /* ignore: userData not accessible, nothing we can do */
  }
}

const store = buildStoreWithRecovery();

// Make sure storageVersion is set on every install path (fresh, migrated,
// or quarantine fallback). Future migrations key off this.
if (store.get('storageVersion') !== STORAGE_VERSION) {
  store.set('storageVersion', STORAGE_VERSION);
}

cleanupOldQuarantinedConfigs();

// Best-effort migration: if a previous build stored a real key in
// `providers[*].apiKey` (plaintext), move it into the encrypted slot once
// and clear the plaintext. Same for the legacy openrouterApiKey field.
(() => {
  const secure = store.get('providersSecure');
  const legacyProviders = store.get('providers') ?? DEFAULT_PROVIDERS;
  const legacyOR = store.get('openrouterApiKey');

  // If we already have a secure map, only check that we don't still have
  // plaintext keys hanging around; clear them.
  if (secure) {
    let needsClear = false;
    const cleaned: Record<ProviderId, ProviderSettings> = { ...legacyProviders };
    for (const id of Object.keys(cleaned) as ProviderId[]) {
      if (cleaned[id]?.apiKey) {
        cleaned[id] = { ...cleaned[id], apiKey: '' };
        needsClear = true;
      }
    }
    if (legacyOR) {
      store.set('openrouterApiKey', '');
      needsClear = true;
    }
    if (needsClear) store.set('providers', cleaned);
    return;
  }

  // Otherwise migrate.
  const plain: Record<ProviderId, ProviderSettings> = { ...DEFAULT_PROVIDERS, ...legacyProviders };
  if (legacyOR && !plain.openrouter?.apiKey) {
    plain.openrouter = { apiKey: legacyOR, enabled: plain.openrouter?.enabled ?? true };
  }
  const encrypted = encryptProviders(plain);
  store.set('providersSecure', encrypted);

  // Clear plaintext copies.
  const cleared: Record<ProviderId, ProviderSettings> = { ...plain };
  for (const id of Object.keys(cleared) as ProviderId[]) {
    cleared[id] = { ...cleared[id], apiKey: '' };
  }
  store.set('providers', cleared);
  if (legacyOR) store.set('openrouterApiKey', '');

  if (!isEncryptionAvailable()) {
    console.warn(
      '[settings] safeStorage encryption is not available on this platform. ' +
        'API keys are stored with base64-only encoding. Set up libsecret / ' +
        'KWallet to enable encryption.',
    );
  }
})();

export function getSettings(): Settings {
  const secure = store.get('providersSecure');
  const providers = decryptProviders(secure);
  return {
    openrouterApiKey: providers.openrouter?.apiKey ?? '',
    primaryModel: store.get('primaryModel'),
    fallbackModel: store.get('fallbackModel'),
    webSearch: store.get('webSearch'),
    workspaceFolder: store.get('workspaceFolder'),
    providers,
    autoApproveTools: store.get('autoApproveTools'),
    memorySaveEnabled: store.get('memorySaveEnabled'),
    maxContextTokens: store.get('maxContextTokens'),
    voiceLanguage: store.get('voiceLanguage') ?? 'auto',
    triggerHotkey:
      store.get('triggerHotkey') === 'CtrlRight'
        ? 'CtrlLeft'
        : store.get('triggerHotkey') ?? defaultTriggerHotkey(),
    userProfile: { ...DEFAULT_USER_PROFILE, ...(store.get('userProfile') ?? {}) },
    personalizePrompts: store.get('personalizePrompts') ?? false,
    dismissOnDoubleClick: store.get('dismissOnDoubleClick') ?? true,
    autoCheckUpdates: store.get('autoCheckUpdates') ?? true,
    audioMode: store.get('audioMode') ?? false,
  };
}

function writeProvidersFromPatch(
  current: Record<ProviderId, ProviderSettings>,
  patch: Partial<Record<ProviderId, ProviderSettings>>,
): void {
  const next: Record<ProviderId, ProviderSettings> = { ...current };
  for (const id of Object.keys(patch) as ProviderId[]) {
    const incoming = patch[id];
    if (!incoming) continue;
    next[id] = { ...next[id], ...incoming };
  }
  store.set('providersSecure', encryptProviders(next));
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = decryptProviders(store.get('providersSecure'));
  if (patch.providers) {
    writeProvidersFromPatch(current, patch.providers);
  }
  if (typeof patch.openrouterApiKey === 'string') {
    const merged: Record<ProviderId, ProviderSettings> = { ...current };
    merged.openrouter = {
      apiKey: patch.openrouterApiKey,
      enabled: current.openrouter?.enabled ?? true,
    };
    store.set('providersSecure', encryptProviders(merged));
  }
  if (typeof patch.primaryModel === 'string' && patch.primaryModel.length > 0) {
    store.set('primaryModel', patch.primaryModel);
  }
  if (typeof patch.fallbackModel === 'string' && patch.fallbackModel.length > 0) {
    store.set('fallbackModel', patch.fallbackModel);
  }
  if (typeof patch.webSearch === 'boolean') store.set('webSearch', patch.webSearch);
  if (typeof patch.workspaceFolder === 'string' && patch.workspaceFolder.length > 0) {
    store.set('workspaceFolder', patch.workspaceFolder);
  }
  if (typeof patch.autoApproveTools === 'boolean') {
    store.set('autoApproveTools', patch.autoApproveTools);
  }
  if (typeof patch.dismissOnDoubleClick === 'boolean') {
    store.set('dismissOnDoubleClick', patch.dismissOnDoubleClick);
  }
  if (typeof patch.memorySaveEnabled === 'boolean') {
    store.set('memorySaveEnabled', patch.memorySaveEnabled);
  }
  if (typeof patch.maxContextTokens === 'number' && Number.isFinite(patch.maxContextTokens)) {
    store.set('maxContextTokens', Math.max(2000, Math.min(64000, Math.round(patch.maxContextTokens))));
  }
  if (typeof patch.voiceLanguage === 'string' && patch.voiceLanguage.length > 0) {
    store.set('voiceLanguage', patch.voiceLanguage);
  }
  if (
    patch.triggerHotkey === 'MetaRight' ||
    patch.triggerHotkey === 'CtrlLeft' ||
    patch.triggerHotkey === 'CtrlRight' ||
    patch.triggerHotkey === 'AltRight' ||
    patch.triggerHotkey === 'ShiftRight'
  ) {
    store.set('triggerHotkey', patch.triggerHotkey);
  }
  if (patch.userProfile && typeof patch.userProfile === 'object') {
    const cur = store.get('userProfile') ?? DEFAULT_USER_PROFILE;
    store.set('userProfile', { ...DEFAULT_USER_PROFILE, ...cur, ...patch.userProfile });
  }
  if (typeof patch.personalizePrompts === 'boolean') {
    store.set('personalizePrompts', patch.personalizePrompts);
  }
  if (typeof patch.autoCheckUpdates === 'boolean') {
    store.set('autoCheckUpdates', patch.autoCheckUpdates);
  }
  if (typeof patch.audioMode === 'boolean') {
    store.set('audioMode', patch.audioMode);
  }
  return getSettings();
}

export function getWorkspaceFolder(): string {
  return store.get('workspaceFolder');
}

export function hasApiKey(): boolean {
  const providers = decryptProviders(store.get('providersSecure'));
  return Object.values(providers).some((p) => p.apiKey.length > 0);
}

// Exposed for tests / diagnostics. Returns the hardcoded string the legacy
// recovery path uses; new writes never touch it.
export function legacyEnvelopeKey(): string {
  return LEGACY_ENVELOPE_KEY;
}
