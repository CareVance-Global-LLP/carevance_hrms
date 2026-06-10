const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 600000;
const DIGEST = 'sha512';

const deriveKey = (password, salt) => {
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST);
  return key;
};

const generateSalt = () => crypto.randomBytes(SALT_LENGTH);

const generateMachineSecret = () => {
  const parts = [
    process.env.COMPUTERNAME || '',
    process.env.USERNAME || '',
    process.env.MACHINE_GUID || '',
    os ? os.hostname() : '',
    require('node:os').hostname(),
  ].filter(Boolean).join(':');
  return crypto.createHash('sha256').update(parts).digest('hex');
};

let os = null;
try { os = require('node:os'); } catch {}

const encrypt = (plaintext, secret = null) => {
  const text = String(plaintext || '');
  if (!text) return null;
  const machineSecret = secret || generateMachineSecret();
  const salt = generateSalt();
  const key = deriveKey(machineSecret, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, authTag, encrypted]);
  return payload.toString('base64');
};

const decrypt = (payload, secret = null) => {
  if (!payload) return null;
  const machineSecret = secret || generateMachineSecret();
  try {
    const buffer = Buffer.from(payload, 'base64');
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const key = deriveKey(machineSecret, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};

const hashString = (value) => {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
};

module.exports = {
  encrypt,
  decrypt,
  hashString,
  generateMachineSecret,
};
