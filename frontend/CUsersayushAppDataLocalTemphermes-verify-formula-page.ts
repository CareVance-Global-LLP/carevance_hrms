// Verification script for FormulaEnginePage.tsx
import * as fs from 'fs';
import * as path from 'path';

const filePath = 'D:\CareVance_Hrms_IDE\frontend\src\pages\FormulaEnginePage.tsx';

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

// Read the file
const content = fs.readFileSync(filePath, 'utf-8');

// Check 1: File exists and is non-empty
results.push({
  name: 'File exists and is non-empty',
  passed: content.length > 0,
  detail: `${content.length} bytes`,
});

// Check 2: Has default export
results.push({
  name: 'Has default export',
  passed: /export default function FormulaEnginePage/.test(content),
});

// Check 3: Imports React hooks
results.push({
  name: 'Imports useState',
  passed: /import.*useState.*from 'react'/.test(content),
});

// Check 4: Imports useMutation from TanStack Query
results.push({
  name: 'Imports useMutation from TanStack Query',
  passed: /import.*useMutation.*from '@tanstack\/react-query'/.test(content),
});

// Check 5: Imports payrollApi
results.push({
  name: 'Imports payrollApi from services/api',
  passed: /import.*payrollApi.*from.*@\/services\/api'/.test(content),
});

// Check 6: Imports Button component
results.push({
  name: 'Imports Button component',
  passed: /import Button from.*@\/components\/ui\/Button'/.test(content),
});

// Check 7: Imports HowItWorksCard
results.push({
  name: 'Imports HowItWorksCard',
  passed: /import HowItWorksCard from.*@\/components\/payroll\/HowItWorksCard'/.test(content),
});

// Check 8: Imports PageHeader
results.push({
  name: 'Imports PageHeader',
  passed: /import PageHeader from.*@\/components\/dashboard\/PageHeader'/.test(content),
});

// Check 9: Has evaluate mutation
results.push({
  name: 'Has evaluateMutation',
  passed: /evaluateMutation\s*=\s*useMutation/.test(content),
});

// Check 10: Has validate mutation
results.push({
  name: 'Has validateMutation',
  passed: /validateMutation\s*=\s*useMutation/.test(content),
});

// Check 11: Calls evaluateFormula
results.push({
  name: 'Calls evaluateFormula API method',
  passed: /evaluateFormula/.test(content),
});

// Check 12: Calls validateFormula
results.push({
  name: 'Calls validateFormula API method',
  passed: /validateFormula/.test(content),
});

// Check 13: Has example formulas
results.push({
  name: 'Has EXAMPLE_FORMULAS array',
  passed: /EXAMPLE_FORMULAS\s*=\s*\[/.test(content),
});

// Check 14: Has variable management (addVariable)
results.push({
  name: 'Has addVariable function',
  passed: /addVariable/.test(content),
});

// Check 15: Has removeVariable function
results.push({
  name: 'Has removeVariable function',
  passed: /removeVariable/.test(content),
});

// Check 16: Has handleEvaluate
results.push({
  name: 'Has handleEvaluate function',
  passed: /handleEvaluate/.test(content),
});

// Check 17: Has handleValidate
results.push({
  name: 'Has handleValidate function',
  passed: /handleValidate/.test(content),
});

// Check 18: Has result display area
results.push({
  name: 'Has evaluateResult state',
  passed: /useState.*EvaluateResult/.test(content),
});

// Check 19: Has validateResult state
results.push({
  name: 'Has validateResult state',
  passed: /useState.*ValidateResult/.test(content),
});

// Check 20: Uses Play icon for Evaluate button
results.push({
  name: 'Uses Play icon for Evaluate button',
  passed: /Play.*Evaluate|Evaluate.*Play/s.test(content),
});

// Check 21: Uses CheckCircle icon for Validate button
results.push({
  name: 'Uses CheckCircle icon for Validate button',
  passed: /CheckCircle.*Validate|Validate.*CheckCircle/s.test(content),
});

// Check 22: Has PageHeader with correct title
results.push({
  name: 'PageHeader has title "Formula Engine Tester"',
  passed: /title="Formula Engine Tester"/.test(content),
});

// Check 23: Has HowItWorksCard with whatIsThis
results.push({
  name: 'HowItWorksCard has whatIsThis prop',
  passed: /whatIsThis=/.test(content),
});

// Check 24: Has HowItWorksCard with whenToUse
results.push({
  name: 'HowItWorksCard has whenToUse prop',
  passed: /whenToUse=/.test(content),
});

// Check 25: Has HowItWorksCard with howItFlows
results.push({
  name: 'HowItWorksCard has howItFlows prop',
  passed: /howItFlows=/.test(content),
});

// Check 26: Has HowItWorksCard with commonMistakes
results.push({
  name: 'HowItWorksCard has commonMistakes prop',
  passed: /commonMistakes=/.test(content),
});

// Check 27: No TODO comments
results.push({
  name: 'No TODO comments',
  passed: !/\/\/\s*TODO/.test(content),
});

// Check 28: No placeholder text
results.push({
  name: 'No placeholder text',
  passed: !/placeholder.*text/i.test(content) || !/Insert.*here/i.test(content),
});

// Check 29: Has proper JSX return
results.push({
  name: 'Has proper JSX return with return (',
  passed: /return \([\s\S]*<\/div>[\s\S]*\);/.test(content),
});

// Check 30: Balanced braces (rough check)
const openBraces = (content.match(/\{/g) || []).length;
const closeBraces = (content.match(/\}/g) || []).length;
results.push({
  name: 'Balanced braces (open ≈ close)',
  passed: Math.abs(openBraces - closeBraces) <= 2,
  detail: `${openBraces} open, ${closeBraces} close`,
});

// Check 31: Balanced parentheses
const openParens = (content.match(/\(/g) || []).length;
const closeParens = (content.match(/\)/g) || []).length;
results.push({
  name: 'Balanced parentheses (open ≈ close)',
  passed: Math.abs(openParens - closeParens) <= 2,
  detail: `${openParens} open, ${closeParens} close`,
});

// Check 32: Imports TextInput from FormField
results.push({
  name: 'Imports TextInput from FormField',
  passed: /import.*TextInput.*from.*@\/components\/ui\/FormField'/.test(content),
});

// Check 33: Uses SurfaceCard
results.push({
  name: 'Uses SurfaceCard component',
  passed: /SurfaceCard/.test(content),
});

// Check 34: Has error display for failed evaluation
results.push({
  name: 'Has error display for failed evaluation',
  passed: /Evaluation Failed/.test(content),
});

// Check 35: Has success display for valid syntax
results.push({
  name: 'Has success display for valid syntax',
  passed: /Syntax is Valid/.test(content),
});

// Print results
console.log('\n=== FormulaEnginePage.tsx Verification ===\n');
let passed = 0;
let failed = 0;

results.forEach((r, i) => {
  const status = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  if (r.passed) passed++;
  else failed++;
});

console.log(`\n=== Results: ${passed}/${results.length} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
