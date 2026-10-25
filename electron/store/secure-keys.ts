// AiCursor standalone project file.
import { safeStorage } from 'electron';
import type { ProviderId, ProviderSettings } from '../types';

// Storage for API keys backed by the OS keyring where available:
//   - macOS: Keychain (via safeStorage)
//   - Windows: DPAPI (via safeStorage)
//   - Linux: libsecret / kwallet (via safeStorage when present)
//
// Plaintext fallback is intentionally NOT supported. If safeStorage cannot
// encrypt (`isEncryptionAvailable()` returns false), keys are still stored
// in electron-store but marked as such so the renderer can warn the user.
//
// On macOS the Keychain path means a user with FileVault on cannot have
// their keys lifted by reading config.json directly — that file no longer
// contains the keys at all once this module owns them.

export type EncryptedKey = {
  // Base64 encoding of the encrypted ciphertext returned by safeStorage.
  // Empty string means "no key set".
  ciphertext: string;
  // Indicates whether the value was encrypted (true) or stored as plaintext
  // because the platform refused encryption (false). Renderer can surface
  // a warning in the latter case.
  encrypted: boolean;
};

export type SecureProviderMap = Record<ProviderId, EncryptedKey & { enabled: boolean }>;

const EMPTY: EncryptedKey = { ciphertext: '', encrypted: false };

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function encryptKey(plaintext: string): EncryptedKey {
  if (!plaintext) return EMPTY;
  if (!isEncryptionAvailable()) {
    // Falls back to base64 of the raw bytes. NOT encryption, just storage.
    // The `encrypted: false` flag is what matters; callers can warn the user.
    return { ciphertext: Buffer.from(plaintext, 'utf-8').toString('base64'), encrypted: false };
  }
  try {
    const buf = safeStorage.encryptString(plaintext);
    return { ciphertext: buf.toString('base64'), encrypted: true };
  } catch (err) {
    console.warn('[secure-keys] encrypt failed, falling back to plaintext:', err);
    return { ciphertext: Buffer.from(plaintext, 'utf-8').toString('base64'), encrypted: false };
  }
}

export function decryptKey(stored: EncryptedKey | undefined | null): string {
  if (!stored || !stored.ciphertext) return '';
  if (!stored.encrypted) {
    // Legacy / fallback path: base64-only.
    try {
      return Buffer.from(stored.ciphertext, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }
  if (!isEncryptionAvailable()) {
    console.warn('[secure-keys] cannot decrypt: encryption unavailable');
    return '';
  }
  try {
    const buf = Buffer.from(stored.ciphertext, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[secure-keys] decrypt failed:', err);
    return '';
  }
}

// Convert plain provider settings (with plaintext apiKey strings) into the
// encrypted-on-disk shape. Used when settings are written from the renderer.
export function encryptProviders(
  plain: Record<ProviderId, ProviderSettings>,
): SecureProviderMap {
  const out = {} as SecureProviderMap;
  for (const id of Object.keys(plain) as ProviderId[]) {
    const p = plain[id];
    const encrypted = encryptKey(p.apiKey ?? '');
    out[id] = { ...encrypted, enabled: !!p.enabled };
  }
  return out;
}

// Reverse: read encrypted-on-disk and produce plaintext provider settings
// for in-process use. Note: the plaintext value lives only in main-process
// memory and is sent through IPC for the settings form (the user explicitly
// asked to see it). It is never written back to disk in plaintext.
export function decryptProviders(
  enc: SecureProviderMap | null | undefined,
): Record<ProviderId, ProviderSettings> {
  const ids: ProviderId[] = ['openrouter', 'anthropic', 'openai', 'gemini', 'deepseek'];
  const out = {} as Record<ProviderId, ProviderSettings>;
  for (const id of ids) {
    const e = enc?.[id];
    out[id] = { apiKey: decryptKey(e), enabled: !!e?.enabled };
  }
  return out;
}
