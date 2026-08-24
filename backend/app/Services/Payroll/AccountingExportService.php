<?php

namespace App\Services\Payroll;

use App\Models\PayrollMonthlyRun;

/**
 * Turning a payroll journal into something an accounting package will accept.
 *
 * TALLY'S SIGN CONVENTION IS BACKWARDS FROM EVERY OTHER SYSTEM, and it is the
 * single thing that goes wrong with Tally imports. In Tally XML a DEBIT is a
 * NEGATIVE amount with ISDEEMEDPOSITIVE = Yes, and a CREDIT is a POSITIVE
 * amount with ISDEEMEDPOSITIVE = No. Get it the intuitive way round and the
 * voucher still imports — it just posts every salary as income, which nobody
 * notices until the P&L is read.
 *
 * ZOHO BOOKS wants a flat journal CSV with one row per line and its own
 * Debit/Credit columns, which is the ordinary convention. Deliberately a
 * separate exporter rather than a flag on one: the two formats disagree about
 * something fundamental, and a shared code path with an `if` in it is where
 * that disagreement gets lost.
 *
 * NEITHER EXPORTER DECIDES ANYTHING. Both are handed an already-balanced
 * journal from PayrollJournalService and refuse to invent, round or omit.
 */
class AccountingExportService
{
    public function __construct(
        private readonly PayrollJournalService $journals,
    ) {
    }

    /**
     * A Tally-importable journal voucher.
     *
     * Dates are YYYYMMDD with no separators, which is what Tally's parser
     * expects and one of the two reasons an import silently produces nothing.
     */
    public function toTallyXml(PayrollMonthlyRun $run): string
    {
        $journal = $this->journals->buildOrFail($run);

        $date = str_replace('-', '', $journal['date']);
        $narration = $this->escape('Payroll for '.$journal['period']);

        $entries = '';

        foreach ($journal['lines'] as $line) {
            $isDebit = $line['side'] === 'debit';

            /*
             * The backwards bit. Debit is negative and "deemed positive"; credit
             * is positive and not. This reads wrong and is right.
             */
            $amount = $isDebit ? '-'.$line['amount'] : $line['amount'];
            $deemedPositive = $isDebit ? 'Yes' : 'No';

            $costCentre = '';
            if (filled($line['cost_center'])) {
                $costCentre = "\n            <COSTCENTRENAME>".$this->escape((string) $line['cost_center']).'</COSTCENTRENAME>';
            }

            $entries .= "
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>".$this->escape((string) $line['ledger'])."</LEDGERNAME>
            <ISDEEMEDPOSITIVE>{$deemedPositive}</ISDEEMEDPOSITIVE>
            <AMOUNT>{$amount}</AMOUNT>{$costCentre}
          </ALLLEDGERENTRIES.LIST>";
        }

        return <<<XML
        <ENVELOPE>
          <HEADER>
            <TALLYREQUEST>Import Data</TALLYREQUEST>
          </HEADER>
          <BODY>
            <IMPORTDATA>
              <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
              </REQUESTDESC>
              <REQUESTDATA>
                <TALLYMESSAGE>
                  <VOUCHER VCHTYPE="Journal" ACTION="Create">
                    <DATE>{$date}</DATE>
                    <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
                    <NARRATION>{$narration}</NARRATION>{$entries}
                  </VOUCHER>
                </TALLYMESSAGE>
              </REQUESTDATA>
            </IMPORTDATA>
          </BODY>
        </ENVELOPE>
        XML;
    }

    /**
     * A Zoho Books journal CSV.
     *
     * One row per line with separate Debit and Credit columns — the ordinary
     * convention, and the one a human reading the file will also understand.
     * Every row repeats the journal date and reference, because Zoho groups
     * rows into one entry by those and a blank on any row splits the journal
     * into two that each fail to balance.
     */
    public function toZohoCsv(PayrollMonthlyRun $run): string
    {
        $journal = $this->journals->buildOrFail($run);

        $reference = 'PAYROLL-'.$journal['period'];

        $rows = [[
            'Journal Date', 'Reference Number', 'Journal Type', 'Description',
            'Account', 'Account Code', 'Cost Center', 'Debit', 'Credit',
        ]];

        foreach ($journal['lines'] as $line) {
            $rows[] = [
                $journal['date'],
                $reference,
                'Journal',
                'Payroll for '.$journal['period'],
                $line['ledger'],
                $line['gl_code'],
                $line['cost_center'] ?? '',
                // Empty, not zero, on the side that does not apply. A row with
                // 0.00 in both columns is one an importer may reject and a
                // human will certainly misread.
                $line['side'] === 'debit' ? $line['amount'] : '',
                $line['side'] === 'credit' ? $line['amount'] : '',
            ];
        }

        return implode("\r\n", array_map(
            fn (array $row) => implode(',', array_map(
                fn ($cell) => '"'.str_replace('"', '""', (string) $cell).'"',
                $row,
            )),
            $rows,
        ));
    }

    /** XML-escape, so a ledger named "R&D" cannot break the document. */
    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
