/**
 * Indian Government ID and Document Format Validation Utilities
 * Client-side validation to catch errors before submitting to API
 */

// Verhoeff checksum table for Aadhaar validation
const verhoeffMultiplication = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const verhoeffPermutation = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const verhoeffInverse = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function validateVerhoeffChecksum(number: string): boolean {
  let c = 0;
  const digits = number.split('').map(Number).reverse();

  for (let i = 0; i < digits.length; i++) {
    c = verhoeffMultiplication[c][verhoeffPermutation[i % 8][digits[i]]];
  }

  return c === 0;
}

export const validateAadhaar = (aadhaar: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = aadhaar.replace(/\D/g, '');

  if (normalized.length !== 12) {
    return { valid: false, error: 'Aadhaar number must be 12 digits', normalized };
  }

  // Check for repeated digits
  if (/(\d)\1{11}/.test(normalized)) {
    return { valid: false, error: 'Invalid Aadhaar number (repeated digits)', normalized };
  }

  // Verhoeff checksum
  if (!validateVerhoeffChecksum(normalized)) {
    return { valid: false, error: 'Invalid Aadhaar number (checksum failed)', normalized };
  }

  return { valid: true, normalized };
};

export const validatePan = (pan: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = pan.toUpperCase().trim();

  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) {
    return {
      valid: false,
      error: 'PAN must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
      normalized,
    };
  }

  // Validate 4th character (type)
  const validTypes = ['C', 'P', 'H', 'F', 'A', 'T', 'B', 'G', 'J', 'L', 'E'];
  if (!validTypes.includes(normalized[3])) {
    return { valid: false, error: 'Invalid PAN type (4th character)', normalized };
  }

  return { valid: true, normalized };
};

export const validatePassport = (passport: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = passport.toUpperCase().trim();

  if (!/^[A-Z][0-9A-Z]{7}$/.test(normalized)) {
    return {
      valid: false,
      error: 'Passport must start with a letter followed by 7 alphanumeric characters',
      normalized,
    };
  }

  return { valid: true, normalized };
};

export const validateDrivingLicense = (dl: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = dl.toUpperCase().replace(/[\s\-]/g, '');

  if (normalized.length < 8 || normalized.length > 16) {
    return {
      valid: false,
      error: 'Driving License number appears invalid (expected 8-16 characters)',
      normalized,
    };
  }

  if (!/^[A-Z]{2}/.test(normalized)) {
    return {
      valid: false,
      error: 'Driving License must start with state code (e.g., MH, DL, KA)',
      normalized,
    };
  }

  return { valid: true, normalized };
};

export const validateVoterId = (voterId: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = voterId.toUpperCase().trim();

  if (!/^[A-Z]{3}[0-9]{7}$/.test(normalized)) {
    return {
      valid: false,
      error: 'Voter ID (EPIC) must be 3 letters followed by 7 digits',
      normalized,
    };
  }

  return { valid: true, normalized };
};

export const validateUan = (uan: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = uan.replace(/\D/g, '');

  if (normalized.length !== 12) {
    return { valid: false, error: 'UAN must be 12 digits', normalized };
  }

  return { valid: true, normalized };
};

export const validateEsiNumber = (esi: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = esi.replace(/\D/g, '');

  if (normalized.length !== 17) {
    return { valid: false, error: 'ESI IP Number must be 17 digits', normalized };
  }

  return { valid: true, normalized };
};

export const validateIfsc = (ifsc: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = ifsc.toUpperCase().trim();

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized)) {
    return {
      valid: false,
      error: 'IFSC must be 11 characters: 4 letters + 0 + 6 alphanumeric',
      normalized,
    };
  }

  return { valid: true, normalized };
};

export const validateUpi = (upi: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = upi.toLowerCase().trim();

  if (!/^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/.test(normalized)) {
    return {
      valid: false,
      error: 'UPI ID must be in format: username@bankname (e.g., name@upi)',
      normalized,
    };
  }

  const username = normalized.split('@')[0];
  if (username.length < 3 || username.length > 50) {
    return { valid: false, error: 'UPI username must be 3-50 characters', normalized };
  }

  return { valid: true, normalized };
};

export const validateBankAccount = (accountNumber: string): { valid: boolean; error?: string; normalized?: string } => {
  const normalized = accountNumber.replace(/\D/g, '');

  if (normalized.length < 9 || normalized.length > 18) {
    return { valid: false, error: 'Bank account number must be 9-18 digits', normalized };
  }

  // Check for repeated digits
  if (/(\d)\1{8,}/.test(normalized)) {
    return { valid: false, error: 'Invalid account number (suspicious pattern)', normalized };
  }

  return { valid: true, normalized };
};

export const validateGovernmentId = (
  idType: string,
  idNumber: string
): { valid: boolean; error?: string; normalized?: string } => {
  const type = idType.toLowerCase();

  switch (type) {
    case 'aadhaar':
      return validateAadhaar(idNumber);
    case 'pan':
      return validatePan(idNumber);
    case 'passport':
      return validatePassport(idNumber);
    case 'driving_license':
    case 'dl':
      return validateDrivingLicense(idNumber);
    case 'voter_id':
    case 'voterid':
    case 'epic':
      return validateVoterId(idNumber);
    case 'uan':
      return validateUan(idNumber);
    case 'esi':
    case 'esi_ip':
      return validateEsiNumber(idNumber);
    default:
      return { valid: false, error: `Unknown ID type: ${idType}`, normalized: idNumber };
  }
};

export const getMaskedId = (idType: string, idNumber: string): string => {
  const normalized = idNumber.replace(/\s/g, '');

  switch (idType.toLowerCase()) {
    case 'aadhaar':
    case 'uan':
      return normalized.slice(0, 4) + 'XXXX' + normalized.slice(-4);
    case 'pan':
      return normalized.slice(0, 2) + 'XXXXX' + normalized.slice(-3);
    case 'passport':
    case 'driving_license':
    case 'dl':
      return normalized.slice(0, 2) + 'XXXXX' + normalized.slice(-2);
    case 'voter_id':
    case 'voterid':
      return normalized.slice(0, 3) + 'XXXX' + normalized.slice(-3);
    case 'esi':
      return normalized.slice(0, 4) + 'XXXXXXXXXXX' + normalized.slice(-4);
    default:
      return 'XXXX' + normalized.slice(-4);
  }
};
