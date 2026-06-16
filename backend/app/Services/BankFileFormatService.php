<?php

namespace App\Services;

use App\Models\BankTransferBatch;
use App\Models\BankTransferItem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Bank File Format Service
 *
 * Generates bank-specific file formats for bulk NEFT/RTGS salary disbursement.
 * Supports HDFC, ICICI, SBI, Yes Bank, Axis Bank and a generic CSV format.
 *
 * Each format has a specific fixed-width or delimited layout that the bank's
 * corporate upload portal accepts. We keep each format in its own method so
 * the same data can be exported to multiple banks without re-querying.
 */
class BankFileFormatService
{
    /**
     * Generate a bank file in the requested format.
     *
     * @param BankTransferBatch $batch
     * @param string $format One of: hdfc, icici, sbi, yes, axis, generic_csv
     * @return array{file_path: string, filename: string, content: string, format: string, transaction_count: int, total_amount: float}
     */
    public function generateFile(BankTransferBatch $batch, string $format = 'hdfc'): array
    {
        $items = $batch->items()->where('status', 'pending')->get();
        $method = 'generate' . ucfirst(strtolower($format)) . 'File';
        if (!method_exists($this, $method)) {
            $method = 'generateGenericCsvFile';
        }
        $content = $this->$method($batch, $items);
        $orgId = $batch->organization_id;
        $filename = sprintf('%s_%s_%s.%s', $format, $batch->batch_reference, now()->format('Ymd_His'), $this->extensionFor($format));
        $path = "filings/{$orgId}/bank_files/{$filename}";
        Storage::disk('local')->put($path, $content);
        $batch->update([
            'file_path' => $path,
            'file_format' => $format,
            'status' => 'file_generated',
        ]);
        return [
            'file_path' => $path,
            'filename' => $filename,
            'content' => $content,
            'format' => $format,
            'transaction_count' => $items->count(),
            'total_amount' => (float) $items->sum('amount'),
        ];
    }

    /**
     * List of supported bank formats.
     */
    public function supportedFormats(): array
    {
        return [
            ['code' => 'hdfc',         'name' => 'HDFC Bank NEFT/RTGS',  'description' => 'HDFC Corporate Salary Upload - Fixed-width 200 chars'],
            ['code' => 'icici',        'name' => 'ICICI Bank NEFT',      'description' => 'ICICI Corporate Salary - Pipe-delimited .txt'],
            ['code' => 'sbi',          'name' => 'SBI Corporate (e-CBG)', 'description' => 'State Bank Collect corporate salary - tab-delimited'],
            ['code' => 'yes',          'name' => 'Yes Bank NEFT',         'description' => 'Yes Bank corporate upload - CSV'],
            ['code' => 'axis',         'name' => 'Axis Bank NEFT',        'description' => 'Axis Multi-Account File Upload - CSV'],
            ['code' => 'kotak',        'name' => 'Kotak Mahindra',        'description' => 'Kotak Salary Disbursement - Excel CSV'],
            ['code' => 'generic_csv',  'name' => 'Generic CSV',           'description' => 'Generic beneficiary CSV for any bank'],
        ];
    }

    // ====================================================================
    // HDFC BANK FORMAT
    // ====================================================================
    // HDFC corporate salary upload expects 200-char fixed-width lines:
    //   Beneficiary Account Number (20) | Beneficiary Name (40) |
    //   IFSC Code (11) | Amount in paise (17) | Beneficiary Type (1) |
    //   Reference 1 (20) | Reference 2 (20) | Beneficiary Email (50) | ... filler
    //   Header row starts with 'H', footer with 'F'.
    // ====================================================================
    private function generateHdfcFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        // Header
        $lines[] = 'H' . str_pad('HDFC CORP SAL', 199, ' ', STR_PAD_RIGHT);
        $i = 1;
        foreach ($items as $item) {
            $row  = str_pad($item->beneficiary_account ?? '', 20, ' ', STR_PAD_RIGHT);
            $row .= str_pad($item->beneficiary_name ?? '', 40, ' ', STR_PAD_RIGHT);
            $row .= str_pad($item->beneficiary_ifsc ?? '', 11, ' ', STR_PAD_RIGHT);
            $row .= str_pad((string) round(((float)$item->amount) * 100), 17, '0', STR_PAD_LEFT);
            $row .= 'I'; // I = Individual
            $row .= str_pad('SAL-' . substr($batch->batch_reference, 0, 18), 20, ' ', STR_PAD_RIGHT);
            $row .= str_pad($item->user_id ?? '', 20, ' ', STR_PAD_RIGHT);
            $row .= str_pad('', 50, ' ', STR_PAD_RIGHT);
            $row .= str_pad('', 21, ' ', STR_PAD_RIGHT);
            $lines[] = $row;
            $i++;
        }
        // Footer
        $lines[] = 'F' . str_pad((string) $items->count(), 10, '0', STR_PAD_LEFT) . str_pad((string) $items->sum('amount') * 100, 17, '0', STR_PAD_LEFT) . str_pad('', 172, ' ', STR_PAD_RIGHT);
        return implode("\r\n", $lines);
    }

    // ====================================================================
    // ICICI BANK FORMAT
    // ====================================================================
    // ICICI corporate upload is pipe-delimited .txt
    //   record_type|beneficiary_account|beneficiary_name|ifsc|amount|
    //   email|mobile|transaction_ref|payment_mode(N/R)
    // ====================================================================
    private function generateIciciFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = implode('|', ['HDR', 'ICICI_CORP', $batch->batch_reference, count($items), $items->sum('amount')]);
        foreach ($items as $item) {
            $lines[] = implode('|', [
                'DTL',
                trim($item->beneficiary_account),
                $this->sanitizeName($item->beneficiary_name),
                strtoupper(trim($item->beneficiary_ifsc)),
                number_format((float)$item->amount, 2, '.', ''),
                '',
                '',
                $batch->batch_reference . '/' . $item->id,
                'N', // NEFT
            ]);
        }
        $lines[] = implode('|', ['TRL', $items->count(), number_format($items->sum('amount'), 2, '.', '')]);
        return implode("\r\n", $lines);
    }

    // ====================================================================
    // SBI e-CBG (Corporate Bulk Gateway) FORMAT
    // ====================================================================
    // Tab-delimited .txt:
    //   debit_account\tbeneficiary_account\tbeneficiary_name\tifsc\tamount\tcurrency
    // ====================================================================
    private function generateSbiFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = implode("\t", ['S', $batch->debit_account ?? 'PENDING', count($items), number_format($items->sum('amount'), 2, '.', '')]);
        foreach ($items as $item) {
            $lines[] = implode("\t", [
                'T',
                trim($item->beneficiary_account),
                $this->sanitizeName($item->beneficiary_name),
                strtoupper(trim($item->beneficiary_ifsc)),
                number_format((float)$item->amount, 2, '.', ''),
                'INR',
            ]);
        }
        $lines[] = implode("\t", ['E']);
        return implode("\r\n", $lines);
    }

    // ====================================================================
    // YES BANK FORMAT (CSV)
    // ====================================================================
    private function generateYesFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = "Beneficiary Account Number,Beneficiary Name,IFSC Code,Amount,Transaction Type,Reference,Customer Reference";
        foreach ($items as $item) {
            $lines[] = sprintf(
                "%s,%s,%s,%.2f,NEFT,%s,%s",
                trim($item->beneficiary_account),
                $this->csvEscape($item->beneficiary_name),
                strtoupper(trim($item->beneficiary_ifsc)),
                (float)$item->amount,
                $batch->batch_reference,
                'SAL' . $item->id
            );
        }
        return implode("\n", $lines);
    }

    // ====================================================================
    // AXIS BANK FORMAT (CSV)
    // ====================================================================
    private function generateAxisFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = "Sr No,Beneficiary Name,Account Number,IFSC,Amount,Mode,Reference";
        $i = 1;
        foreach ($items as $item) {
            $lines[] = sprintf(
                "%d,%s,%s,%s,%.2f,NEFT,%s",
                $i++,
                $this->csvEscape($item->beneficiary_name),
                trim($item->beneficiary_account),
                strtoupper(trim($item->beneficiary_ifsc)),
                (float)$item->amount,
                $batch->batch_reference
            );
        }
        return implode("\n", $lines);
    }

    // ====================================================================
    // KOTAK MAHINDRA FORMAT (CSV)
    // ====================================================================
    private function generateKotakFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = "Beneficiary Account,Beneficiary Name,IFSC,Amount,Purpose";
        foreach ($items as $item) {
            $lines[] = sprintf(
                "%s,%s,%s,%.2f,Salary",
                trim($item->beneficiary_account),
                $this->csvEscape($item->beneficiary_name),
                strtoupper(trim($item->beneficiary_ifsc)),
                (float)$item->amount
            );
        }
        return implode("\n", $lines);
    }

    // ====================================================================
    // GENERIC CSV (works with most banks as a fallback)
    // ====================================================================
    private function generateGenericCsvFile(BankTransferBatch $batch, $items): string
    {
        $lines = [];
        $lines[] = "Employee ID,Beneficiary Name,Account Number,IFSC Code,Amount,Reference,Email,Mobile";
        foreach ($items as $item) {
            $lines[] = sprintf(
                "%s,%s,%s,%s,%.2f,%s,%s,%s",
                $item->user_id,
                $this->csvEscape($item->beneficiary_name),
                trim($item->beneficiary_account),
                strtoupper(trim($item->beneficiary_ifsc)),
                (float)$item->amount,
                $batch->batch_reference,
                $item->user->email ?? '',
                $item->user->phone ?? ''
            );
        }
        return implode("\n", $lines);
    }

    // ====================================================================
    // HELPERS
    // ====================================================================
    private function sanitizeName(string $name): string
    {
        // Banks reject names with special characters like /, \, :
        $name = str_replace(['/', '\\', ':', ';', ',', '|'], ' ', $name);
        return preg_replace('/\s+/', ' ', trim($name));
    }

    private function csvEscape(string $value): string
    {
        if (str_contains($value, ',') || str_contains($value, '"') || str_contains($value, "\n")) {
            return '"' . str_replace('"', '""', $value) . '"';
        }
        return $value;
    }

    private function extensionFor(string $format): string
    {
        $fixed = ['hdfc' => 'txt', 'icici' => 'txt', 'sbi' => 'txt'];
        return $fixed[$format] ?? 'csv';
    }
}
