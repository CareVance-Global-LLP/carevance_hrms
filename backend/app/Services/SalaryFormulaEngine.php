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

    /**
     * Substitute variables in both `[Name]` and bare `Name` form.
     *
     * Bare names previously were NOT substituted, so a formula written the way
     * the docs describe it — `CTC * 0.08` — resolved `CTC` to (float)"CTC" = 0
     * and the component silently paid nothing. Longest names are replaced
     * first so `MonthlyCTC` is not clobbered by `CTC`.
     */
    private function replaceVariables(string $expression): string
    {
        $names = array_keys($this->variables);
        usort($names, static fn ($a, $b) => strlen($b) <=> strlen($a));

        foreach ($names as $name) {
            $value = (string) $this->variables[$name];
            $quoted = preg_quote($name, '/');

            // Bracketed form first.
            $expression = preg_replace('/\[' . $quoted . '\]/i', $value, $expression);
            // Then the bare form, on word boundaries only.
            $expression = preg_replace('/\b' . $quoted . '\b/i', $value, $expression);
        }

        return $expression;
    }

    /**
     * Resolve function calls, innermost first.
     *
     * Only IF() was ever substituted here. MAX/MIN/ROUND/ABS/FLOOR/CEIL were
     * registered in registerBuiltinFunctions() and advertised by
     * getAvailableFunctions(), but never replaced — so `MAX(Basic, 15000)`
     * fell through to evaluateSimple("MAX1") and returned 0.0 while
     * validateFormula() still reported the formula as valid.
     */
    private function replaceFunctions(string $expression): string
    {
        $names = array_merge(['IF'], array_keys($this->functions));
        $pattern = '/\b(' . implode('|', array_map(
            static fn ($n) => preg_quote($n, '/'),
            $names
        )) . ')\s*\(([^()]*)\)/i';

        // Innermost-first so nested calls such as MAX(MIN(a,b),c) resolve.
        // Bounded to avoid spinning on a pathological expression.
        for ($guard = 0; $guard < 100; $guard++) {
            $replaced = preg_replace_callback($pattern, function (array $m): string {
                $name = strtoupper($m[1]);
                $args = $this->splitArguments($m[2]);

                if ($name === 'IF') {
                    if (count($args) !== 3) {
                        throw new \RuntimeException('IF() expects 3 arguments, got ' . count($args));
                    }

                    return $this->evaluateCondition($args[0]) ? $args[1] : $args[2];
                }

                $fn = $this->functions[$name] ?? null;
                if ($fn === null) {
                    throw new \RuntimeException("Unknown function {$name}()");
                }

                // Arguments are themselves expressions.
                $values = array_map(fn (string $arg) => $this->parseExpression($arg), $args);

                return (string) $fn(...$values);
            }, $expression);

            if ($replaced === null) {
                throw new \RuntimeException('Formula could not be parsed');
            }
            if ($replaced === $expression) {
                return $replaced;
            }

            $expression = $replaced;
        }

        throw new \RuntimeException('Formula nesting too deep');
    }

    /**
     * Split a function argument list on top-level commas.
     *
     * @return array<int,string>
     */
    private function splitArguments(string $args): array
    {
        if (trim($args) === '') {
            return [];
        }

        return array_map('trim', explode(',', $args));
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
        $expr = trim($expr);
        if ($expr === '') {
            return 0;
        }

        // Any leftover alphabetic text at this point is an unresolved variable
        // or function name. It used to be cast to (float) — yielding 0 — so a
        // typo'd or unsupported formula silently paid nothing and still passed
        // validateFormula(). Fail loudly instead.
        if (preg_match('/[A-Za-z_\[\]]/', $expr)) {
            throw new \RuntimeException("Unresolved token in formula fragment '{$expr}'");
        }

        $tokens = preg_split('/([+\-*\/])/', $expr, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
        if ($tokens === false || count($tokens) === 0) return 0;

        // Fold unary +/- into the following number so "-5" or "3*-2" parse.
        $tokens = $this->foldUnarySigns($tokens);

        if (count($tokens) === 1) {
            return $this->toNumber($tokens[0]);
        }

        $operators = ['*', '/'];
        foreach ($operators as $op) {
            $i = 1;
            while ($i < count($tokens)) {
                if ($tokens[$i] === $op) {
                    $left = $this->toNumber($tokens[$i - 1]);
                    $right = $this->toNumber($tokens[$i + 1]);
                    $result = $op === '*' ? $left * $right : ($right != 0 ? $left / $right : 0);
                    array_splice($tokens, $i - 1, 3, [$result]);
                    $i = 1;
                } else {
                    $i += 2;
                }
            }
        }

        $result = $this->toNumber($tokens[0]);
        for ($i = 1; $i < count($tokens); $i += 2) {
            $op = $tokens[$i];
            $right = $this->toNumber($tokens[$i + 1] ?? '0');
            $result = $op === '+' ? $result + $right : $result - $right;
        }

        return $result;
    }

    /**
     * Merge a leading or post-operator +/- into the numeric token it signs,
     * so "-5" and "3*-2" evaluate correctly instead of splitting into a bare
     * operator token.
     *
     * @param  array<int,string|float>  $tokens
     * @return array<int,string|float>
     */
    private function foldUnarySigns(array $tokens): array
    {
        $out = [];
        foreach ($tokens as $token) {
            $isSign = $token === '-' || $token === '+';
            $prev = $out === [] ? null : $out[count($out) - 1];
            $prevIsOperator = $prev !== null && in_array($prev, ['+', '-', '*', '/'], true);

            if ($isSign && ($out === [] || $prevIsOperator)) {
                $out[] = $token === '-' ? '-1' : '1';
                $out[] = '*';
                continue;
            }

            $out[] = $token;
        }

        return $out;
    }

    /** Strict numeric cast — anything non-numeric is a formula error. */
    private function toNumber(string|float|int $token): float
    {
        if (is_float($token) || is_int($token)) {
            return (float) $token;
        }

        $trimmed = trim($token);
        if (!is_numeric($trimmed)) {
            throw new \RuntimeException("Non-numeric token '{$token}' in formula");
        }

        return (float) $trimmed;
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
