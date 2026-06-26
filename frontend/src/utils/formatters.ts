/**
 * Format a number as Indian currency (₹ with comma separators)
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  
  // Format with Indian numbering system (lakhs, crores)
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  
  // Add commas for Indian numbering
  let result = intPart.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  
  // Handle the special case for Indian numbering (last 3 digits, then groups of 2)
  const parts = intPart.split('');
  if (parts.length > 3) {
    const last3 = parts.slice(-3).join('');
    const remaining = parts.slice(0, -3);
    const formatted = remaining.reverse().reduce((acc, digit, i) => {
      if (i % 2 === 0 && i > 0) return digit + ',' + acc;
      return digit + acc;
    }, '');
    result = formatted + ',' + last3;
  }
  
  return result + '.' + decPart;
}

/**
 * Get month name from month number (1-12)
 */
export function getMonthName(month: number): string {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month] || '';
}
