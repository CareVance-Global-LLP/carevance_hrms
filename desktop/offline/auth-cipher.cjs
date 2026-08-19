const { encrypt, decrypt } = require('./crypto-utils.cjs');

/**
 * How the offline auth session is sealed on disk.
 *
 * Two schemes, and every stored row records which one sealed it so both stay
 * readable across an upgrade:
 *
 *   safe_storage  The OS keyring — DPAPI on Windows, Keychain on macOS,
 *                 libsecret on Linux. The key never leaves the OS and is bound
 *                 to the user account, so a copied database file is inert.
 *                 Preferred wherever it is available.
 *
 *   machine_key   AES-256-GCM under a PBKDF2 key derived from machine
 *                 identifiers. Weaker by design — anything that can read the
 *                 file can generally reproduce the inputs — but it is the
 *                 honest fallback for a Linux box with no keyring, and it is
 *                 categorically better than the plaintext column it replaces.
 *
 * There is deliberately no third scheme. A row that cannot be opened by the
 * cipher it names is refused, not returned half-populated: a session object
 * with no token in it reads as "signed in" to every caller downstream.
 */

const SAFE_STORAGE = 'safe_storage';
const MACHINE_KEY = 'machine_key';

const isKeyringUsable = (safeStorage) => {
  try {
    return Boolean(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable());
  } catch {
    // A keyring that throws on the availability check is not one to trust with
    // the session.
    return false;
  }
};

/**
 * @param {object}  options
 * @param {object=} options.safeStorage   Electron's `safeStorage`, or null in tests.
 * @param {string=} options.machineSecret Secret for the fallback scheme.
 */
const createAuthCipher = ({ safeStorage = null, machineSecret = '' } = {}) => {
  const keyringUsable = isKeyringUsable(safeStorage);

  const schemes = {
    [MACHINE_KEY]: {
      seal: (plaintext) => encrypt(plaintext, machineSecret),
      open: (payload) => decrypt(payload, machineSecret),
    },
  };

  if (keyringUsable) {
    schemes[SAFE_STORAGE] = {
      seal: (plaintext) => safeStorage.encryptString(plaintext).toString('base64'),
      open: (payload) => safeStorage.decryptString(Buffer.from(payload, 'base64')),
    };
  }

  const preferredId = keyringUsable ? SAFE_STORAGE : MACHINE_KEY;

  return {
    preferredId,

    /** @returns {{cipher: string, payload: string}|null} */
    encrypt(plaintext) {
      const text = String(plaintext || '');
      if (!text) return null;

      try {
        const payload = schemes[preferredId].seal(text);
        return payload ? { cipher: preferredId, payload } : null;
      } catch {
        // The keyring can disappear between the availability check and the
        // call — a locked keychain, a revoked session. Fall back rather than
        // lose the sign-in, but never fall back to storing it in the clear.
        if (preferredId === SAFE_STORAGE) {
          const payload = schemes[MACHINE_KEY].seal(text);
          return payload ? { cipher: MACHINE_KEY, payload } : null;
        }
        return null;
      }
    },

    /** @returns {string|null} */
    decrypt(cipherId, payload) {
      if (!payload) return null;

      const scheme = schemes[cipherId || MACHINE_KEY];
      if (!scheme) return null;

      try {
        return scheme.open(payload) || null;
      } catch {
        return null;
      }
    },
  };
};

module.exports = { createAuthCipher, SAFE_STORAGE, MACHINE_KEY };
