<?php

namespace App\Services;

use App\Models\SalaryFormula;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollItem;

class SalaryFormulaEngine
{
    private array $variables = [];
    private array $functions = [];

    public function __construct()
    {
        $this->registerBuiltinFunctions();
    }

    public function setVariable(string $name, float $value): self
    {
        $this->variables[$name] = $value;
        return $this;
    }

    public function setVariables(array $variables): self
    {
        foreach ($variables as $name => $value) {
            $this->variables[$name] = $value;
        }
        return $this;
    }

    public function evaluate(string $expression): float
    {
        $expression = trim($expression);
        $expression = $this->replaceVariables($expression);
        $expression = $this->replaceFunctions($expression);

        try {
            $result = $this->parseExpression($expression);
            return round((float) $result, 2);
        } catch (\Throwable $e) {
            throw new \RuntimeException("Formula evaluation error: '{$expression}' - " . $e->getMessage());
        }
    }

    public function evaluateForTemplate(EmployeePayrollTemplate $template, string $expression): float
    {
        $annualCtc = (float) $template->annual_ctc;
        $monthlyCtc = $annualCtc / 12;
        $basic = $monthlyCtc * ((float) ($template->basic_percentage ?? 40) / 100);
        $hra = $basic * ((float) ($template->hra_percentage ?? 50) / 100);

        $this->setVariables([
            'CTC' => $annualCtc,
            'MonthlyCTC' => $monthlyCtc,
            'Basic' => $basic,
            'HRA' => $hra,
            'Conveyance' => (float) ($template->conveyance_allowance ?? 0),
            'Medical' => (float) ($template->medical_allowance ?? 0),
            'Special' => (float) ($template->special_allowance ?? 0),
            'BasicPct' => (float) ($template->basic_percentage ?? 40),
            'HRAPct' => (float) ($template->hra_percentage ?? 50),
            'Gross' => $monthlyCtc,
            'PFEnabled' => $template->pf_enabled ? 1 : 0,
            'ESIEnabled' => $template->esi_enabled ? 1 : 0,
        ]);

        return $this->evaluate($expression);
    }

    public function evaluateForPayrollItem(PayrollItem $item, string $expression): float
    {
        $this->setVariables([
            'Basic' => (float) $item->basic,
            'HRA' => (float) $item->hra,
            'Conveyance' => (float) $item->conveyance,
            'Medical' => (float) $item->medical,
            'Special' => (float) $item->special_allowance,
            'Gross' => (float) $item->gross_salary,
            'PF' => (float) $item->pf_employee,
            'ESI' => (float) $item->esi_employee,
            'PT' => (float) $item->pt,
            'TDS' => (float) $item->tds,
            'NetPay' => (float) $item->net_pay,
            'LOP' => (float) $item->lOP_days,
            'WorkingDays' => (float) ($item->total_working_days ?? 26),
            'PresentDays' => (float) ($item->days_present ?? 0),
        ]);

        return $this->evaluate($expression);
    }

    private function replaceVariables(string $expression): string
    {
        foreach ($this->variables as $name => $value) {
            $expression = preg_replace('/\[' . preg_quote($name, '/') . '\]/', (string) $value, $expression);
        }
        return $expression;
    }

    private function replaceFunctions(string $expression): string
    {
        return preg_replace_callback('/IF\s*\(([^,]+),([^,]+),([^)]+)\)/i', function ($m) {
            $condition = trim($m[1]);
            $trueVal = trim($m[2]);
            $falseVal = trim($m[3]);
            $condResult = $this->evaluateCondition($condition);
            return $condResult ? $trueVal : $falseVal;
        }, $expression);
    }

    private function evaluateCondition(string $condition): bool
    {
        if (preg_match('/^([^<>!]+)(>=|<=|!=|==|>|<)(.+)$/', $condition, $m)) {
            $left = (float) trim($m[1]);
            $right = (float) trim($m[3]);
            return match ($m[2]) {
                '>' => $left > $right,
                '<' => $left < $right,
                '>=' => $left >= $right,
                '<=' => $left <= $right,
                '==' => abs($left - $right) < 0.001,
                '!=' => abs($left - $right) >= 0.001,
                default => false,
            };
        }
        return (bool) (float) $condition;
    }

    private function parseExpression(string $expr): float
    {
        $expr = preg_replace('/\s+/', '', $expr);
        $expr = str_replace(' ', '', $expr);
        $expr = $this->resolveParentheses($expr);

        return $this->evaluateSimple($expr);
    }

    private function resolveParentheses(string $expr): string
    {
        while (preg_match('/\(([^()]+)\)/', $expr, $m)) {
            $result = $this->evaluateSimple($m[1]);
            $expr = str_replace($m[0], (string) $result, $expr);
        }
        return $expr;
    }

    private function evaluateSimple(string $expr): float
    {
        $tokens = preg_split('/([+\-*\/])/', $expr, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
        if (count($tokens) === 0) return 0;
        if (count($tokens) === 1) return (float) $tokens[0];

        $operators = ['*', '/'];
        foreach ($operators as $op) {
            $i = 1;
            while ($i < count($tokens)) {
                if ($tokens[$i] === $op) {
                    $left = (float) $tokens[$i - 1];
                    $right = (float) $tokens[$i + 1];
                    $result = $op === '*' ? $left * $right : ($right != 0 ? $left / $right : 0);
                    array_splice($tokens, $i - 1, 3, [$result]);
                    $i = 1;
                } else {
                    $i += 2;
                }
            }
        }

        $result = (float) $tokens[0];
        for ($i = 1; $i < count($tokens); $i += 2) {
            $op = $tokens[$i];
            $right = (float) $tokens[$i + 1];
            $result = $op === '+' ? $result + $right : $result - $right;
        }

        return $result;
    }

    private function registerBuiltinFunctions(): void
    {
        $this->functions = [
            'MAX' => fn($a, $b) => max((float) $a, (float) $b),
            'MIN' => fn($a, $b) => min((float) $a, (float) $b),
            'ROUND' => fn($v, $d = 0) => round((float) $v, (int) $d),
            'ABS' => fn($v) => abs((float) $v),
            'FLOOR' => fn($v) => floor((float) $v),
            'CEIL' => fn($v) => ceil((float) $v),
        ];
    }

    public function getVariables(): array
    {
        return $this->variables;
    }

    public static function getAvailableVariables(): array
    {
        return [
            'CTC', 'MonthlyCTC', 'Basic', 'HRA', 'Conveyance', 'Medical', 'Special',
            'BasicPct', 'HRAPct', 'Gross', 'PF', 'ESI', 'PT', 'TDS', 'NetPay',
            'LOP', 'WorkingDays', 'PresentDays', 'PFEnabled', 'ESIEnabled',
        ];
    }

    public function validateFormula(string $expression): bool
    {
        try {
            $this->evaluate($expression);
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    public function getAvailableFunctions(): array
    {
        return [
            'IF(condition, trueVal, falseVal)' => 'Conditional evaluation',
            'MAX(a, b)' => 'Returns maximum of two values',
            'MIN(a, b)' => 'Returns minimum of two values',
            'ROUND(val, decimals)' => 'Rounds a number',
            'ABS(val)' => 'Absolute value',
            'FLOOR(val)' => 'Floor value',
            'CEIL(val)' => 'Ceiling value',
        ];
    }
}
